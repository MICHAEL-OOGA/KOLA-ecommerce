import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  addCartItem,
  clearServerCart as clearServerCartRequest,
  getCart,
  removeCartItem,
  updateCartItem,
} from "../api/cart.api.js";

import { useAuth } from "./AuthContext.jsx";

const CartContext = createContext(null);

const LEGACY_CART_STORAGE_KEY = "KOLA_cart_v1";

/*
|--------------------------------------------------------------------------
| Remove old localStorage cart
|--------------------------------------------------------------------------
*/

const removeLegacyCartStorage = () => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  } catch {
    // localStorage failure must not break KOLA.
  }
};

/*
|--------------------------------------------------------------------------
| Normalize server cart item
|--------------------------------------------------------------------------
*/

const normalizeServerCartItem = (item) => {
  if (
    !item?.product?.id ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity <= 0
  ) {
    return null;
  }

  return {
    product: item.product,
    quantity: item.quantity,
  };
};

const normalizeServerCart = (cart) => {
  if (!Array.isArray(cart?.items)) {
    return [];
  }

  return cart.items.map(normalizeServerCartItem).filter(Boolean);
};

export function CartProvider({ children }) {
  const { authReady, isAuthenticated, user, csrfToken } = useAuth();

  const [cartItems, setCartItems] = useState([]);

  const [cartReady, setCartReady] = useState(false);

  const [cartRefreshing, setCartRefreshing] = useState(false);

  const [cartError, setCartError] = useState(null);

  /*
  |--------------------------------------------------------------------------
  | Latest cart state
  |--------------------------------------------------------------------------
  */

  const cartItemsRef = useRef([]);

  /*
  |--------------------------------------------------------------------------
  | Current authenticated customer
  |--------------------------------------------------------------------------
  */

  const activeUserId = isAuthenticated && user?.id ? user.id : null;

  const activeUserIdRef = useRef(activeUserId);

  activeUserIdRef.current = activeUserId;

  /*
  |--------------------------------------------------------------------------
  | Mutation queue
  |--------------------------------------------------------------------------
  */

  const mutationQueueRef = useRef(Promise.resolve());

  /*
  |--------------------------------------------------------------------------
  | Mutation generation
  |--------------------------------------------------------------------------
  */

  const mutationGenerationRef = useRef(0);

  /*
  |--------------------------------------------------------------------------
  | Commit local cart
  |--------------------------------------------------------------------------
  */

  const commitCartItems = useCallback((nextItems) => {
    cartItemsRef.current = nextItems;

    setCartItems(nextItems);
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Queue server mutation
  |--------------------------------------------------------------------------
  */

  const enqueueMutation = useCallback((operation) => {
    const queuedOperation = mutationQueueRef.current.then(operation, operation);

    mutationQueueRef.current = queuedOperation.catch(() => undefined);

    return queuedOperation;
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Load authoritative server cart
  |--------------------------------------------------------------------------
  */

  const loadServerCart = useCallback(
    async ({ userId, signal }) => {
      const cart = await getCart({
        signal,
      });

      if (signal?.aborted) {
        return null;
      }

      if (activeUserIdRef.current !== userId) {
        return null;
      }

      const nextItems = normalizeServerCart(cart);

      commitCartItems(nextItems);

      removeLegacyCartStorage();

      /*
       * Return the exact server-derived
       * cart we just committed.
       *
       * This is useful during checkout
       * because React state updates are
       * asynchronous.
       */

      return nextItems;
    },
    [commitCartItems],
  );

  /*
  |--------------------------------------------------------------------------
  | Refresh authoritative cart
  |--------------------------------------------------------------------------
  |
  | Any queued optimistic mutations are allowed to settle first.
  |
  | This prevents:
  |
  | PATCH quantity still running
  |            ↓
  | GET cart
  |            ↓
  | stale server representation
  */

  const refreshCart = useCallback(async () => {
    if (!authReady || !isAuthenticated || !user?.id) {
      return null;
    }

    const userIdAtStart = user.id;

    setCartRefreshing(true);

    try {
      /*
       * mutationQueueRef.current always represents
       * the currently queued mutation chain.
       */

      await mutationQueueRef.current;

      if (activeUserIdRef.current !== userIdAtStart) {
        return null;
      }

      const nextItems = await loadServerCart({
        userId: userIdAtStart,
      });

      if (activeUserIdRef.current === userIdAtStart) {
        setCartError(null);
      }

      return nextItems;
    } catch (error) {
      console.error("Cart refresh failed:", error);

      if (activeUserIdRef.current === userIdAtStart) {
        setCartError(error?.message || "Your cart could not be refreshed.");
      }

      return null;
    } finally {
      if (activeUserIdRef.current === userIdAtStart) {
        setCartRefreshing(false);
      }
    }
  }, [authReady, isAuthenticated, user?.id, loadServerCart]);

  /*
  |--------------------------------------------------------------------------
  | Restore cart after authentication
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const controller = new AbortController();

    mutationGenerationRef.current += 1;

    setCartRefreshing(false);

    if (!authReady) {
      setCartReady(false);

      return () => {
        controller.abort();
      };
    }

    if (!isAuthenticated || !user?.id) {
      commitCartItems([]);

      setCartError(null);
      setCartReady(true);

      return () => {
        controller.abort();
      };
    }

    const userIdAtStart = user.id;

    commitCartItems([]);

    setCartReady(false);
    setCartError(null);

    const restoreCart = async () => {
      try {
        await loadServerCart({
          userId: userIdAtStart,

          signal: controller.signal,
        });

        if (
          !controller.signal.aborted &&
          activeUserIdRef.current === userIdAtStart
        ) {
          setCartReady(true);
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        if (activeUserIdRef.current !== userIdAtStart) {
          return;
        }

        console.error("Cart restoration failed:", error);

        commitCartItems([]);

        setCartError(error?.message || "Your cart could not be loaded.");

        setCartReady(true);
      }
    };

    void restoreCart();

    return () => {
      controller.abort();
    };
  }, [authReady, isAuthenticated, user?.id, commitCartItems, loadServerCart]);

  /*
  |--------------------------------------------------------------------------
  | Check whether cart mutations are allowed
  |--------------------------------------------------------------------------
  */

  const cartMutationIsAvailable = () => {
    if (!authReady || !cartReady) {
      return false;
    }

    if (!isAuthenticated || !user?.id) {
      return false;
    }

    if (!csrfToken) {
      setCartError("Your secure session is not ready. Please try again.");

      return false;
    }

    return true;
  };

  /*
  |--------------------------------------------------------------------------
  | Recover from failed optimistic mutation
  |--------------------------------------------------------------------------
  */

  const recoverFromMutationFailure = async ({
    error,
    userId,
    generation,
    fallbackMessage,
  }) => {
    if (
      activeUserIdRef.current !== userId ||
      mutationGenerationRef.current !== generation
    ) {
      return false;
    }

    mutationGenerationRef.current += 1;

    try {
      await loadServerCart({
        userId,
      });
    } catch (reloadError) {
      console.error("Cart reconciliation failed:", reloadError);
    }

    if (activeUserIdRef.current === userId) {
      setCartError(error?.message || fallbackMessage);
    }

    return false;
  };

  /*
  |--------------------------------------------------------------------------
  | Merge fresh product information
  |--------------------------------------------------------------------------
  */

  const mergeServerProduct = (responseItem) => {
    const normalizedItem = normalizeServerCartItem(responseItem);

    if (!normalizedItem) {
      return;
    }

    const currentItems = cartItemsRef.current;

    const nextItems = currentItems.map((item) => {
      if (item.product.id !== normalizedItem.product.id) {
        return item;
      }

      return {
        ...item,

        product: normalizedItem.product,
      };
    });

    commitCartItems(nextItems);
  };

  /*
  |--------------------------------------------------------------------------
  | Add / increase product
  |--------------------------------------------------------------------------
  */

  const addToCart = (product, quantity = 1) => {
    if (!cartMutationIsAvailable()) {
      return Promise.resolve(false);
    }

    if (!product?.id) {
      setCartError("This product is unavailable.");

      return Promise.resolve(false);
    }

    const stock = Number(product.stock);

    if (!Number.isSafeInteger(stock) || stock <= 0) {
      setCartError("This product is currently out of stock.");

      return Promise.resolve(false);
    }

    const safeQuantity =
      Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;

    const currentItems = cartItemsRef.current;

    const existingItem = currentItems.find(
      (item) => item.product.id === product.id,
    );

    let nextQuantity;
    let nextItems;

    /*
     * Existing item
     */

    if (existingItem) {
      if (existingItem.quantity >= stock) {
        setCartError(
          "You already have the maximum currently available quantity in your cart.",
        );

        return Promise.resolve(false);
      }

      nextQuantity = Math.min(existingItem.quantity + safeQuantity, stock);

      if (nextQuantity === existingItem.quantity) {
        setCartError("Maximum available quantity reached.");

        return Promise.resolve(false);
      }

      nextItems = currentItems.map((item) => {
        if (item.product.id === product.id) {
          return {
            ...item,

            quantity: nextQuantity,
          };
        }

        return item;
      });
    } else {
      /*
       * New item
       */

      nextQuantity = Math.min(safeQuantity, stock);

      nextItems = [
        ...currentItems,

        {
          product,

          quantity: nextQuantity,
        },
      ];
    }

    /*
     * Optimistic UI
     */

    commitCartItems(nextItems);

    setCartError(null);

    const userIdAtStart = user.id;

    const generationAtStart = mutationGenerationRef.current;

    return enqueueMutation(async () => {
      if (
        activeUserIdRef.current !== userIdAtStart ||
        mutationGenerationRef.current !== generationAtStart
      ) {
        return false;
      }

      try {
        let response;

        if (existingItem) {
          response = await updateCartItem({
            productId: product.id,

            quantity: nextQuantity,

            csrfToken,
          });
        } else {
          response = await addCartItem({
            productId: product.id,

            quantity: nextQuantity,

            csrfToken,
          });
        }

        if (
          activeUserIdRef.current !== userIdAtStart ||
          mutationGenerationRef.current !== generationAtStart
        ) {
          return false;
        }

        mergeServerProduct(response.item);

        setCartError(null);

        return true;
      } catch (error) {
        console.error("Add to cart failed:", error);

        return recoverFromMutationFailure({
          error,

          userId: userIdAtStart,

          generation: generationAtStart,

          fallbackMessage: "The product could not be added to your cart.",
        });
      }
    });
  };

  /*
  |--------------------------------------------------------------------------
  | Decrease quantity
  |--------------------------------------------------------------------------
  */

  const decreaseCartQuantity = (productId) => {
    if (!cartMutationIsAvailable()) {
      return Promise.resolve(false);
    }

    const existingItem = cartItemsRef.current.find(
      (item) => item.product.id === productId,
    );

    if (!existingItem) {
      return Promise.resolve(false);
    }

    const nextQuantity = existingItem.quantity - 1;

    if (nextQuantity <= 0) {
      commitCartItems(
        cartItemsRef.current.filter((item) => item.product.id !== productId),
      );
    } else {
      commitCartItems(
        cartItemsRef.current.map((item) => {
          if (item.product.id === productId) {
            return {
              ...item,

              quantity: nextQuantity,
            };
          }

          return item;
        }),
      );
    }

    setCartError(null);

    const userIdAtStart = user.id;

    const generationAtStart = mutationGenerationRef.current;

    return enqueueMutation(async () => {
      if (
        activeUserIdRef.current !== userIdAtStart ||
        mutationGenerationRef.current !== generationAtStart
      ) {
        return false;
      }

      try {
        if (nextQuantity <= 0) {
          await removeCartItem({
            productId,
            csrfToken,
          });
        } else {
          const response = await updateCartItem({
            productId,

            quantity: nextQuantity,

            csrfToken,
          });

          mergeServerProduct(response.item);
        }

        setCartError(null);

        return true;
      } catch (error) {
        console.error("Decrease cart quantity failed:", error);

        return recoverFromMutationFailure({
          error,

          userId: userIdAtStart,

          generation: generationAtStart,

          fallbackMessage: "The cart quantity could not be updated.",
        });
      }
    });
  };

  /*
  |--------------------------------------------------------------------------
  | Remove product
  |--------------------------------------------------------------------------
  */

  const removeFromCart = (productId) => {
    if (!cartMutationIsAvailable()) {
      return Promise.resolve(false);
    }

    const itemExists = cartItemsRef.current.some(
      (item) => item.product.id === productId,
    );

    if (!itemExists) {
      return Promise.resolve(false);
    }

    commitCartItems(
      cartItemsRef.current.filter((item) => item.product.id !== productId),
    );

    setCartError(null);

    const userIdAtStart = user.id;

    const generationAtStart = mutationGenerationRef.current;

    return enqueueMutation(async () => {
      if (
        activeUserIdRef.current !== userIdAtStart ||
        mutationGenerationRef.current !== generationAtStart
      ) {
        return false;
      }

      try {
        await removeCartItem({
          productId,
          csrfToken,
        });

        setCartError(null);

        return true;
      } catch (error) {
        console.error("Remove from cart failed:", error);

        return recoverFromMutationFailure({
          error,

          userId: userIdAtStart,

          generation: generationAtStart,

          fallbackMessage: "The product could not be removed from your cart.",
        });
      }
    });
  };

  /*
  |--------------------------------------------------------------------------
  | Clear server cart
  |--------------------------------------------------------------------------
  */

  const clearCartOnServer = () => {
    if (!cartMutationIsAvailable()) {
      return Promise.resolve(false);
    }

    commitCartItems([]);

    setCartError(null);

    const userIdAtStart = user.id;

    const generationAtStart = mutationGenerationRef.current;

    return enqueueMutation(async () => {
      if (
        activeUserIdRef.current !== userIdAtStart ||
        mutationGenerationRef.current !== generationAtStart
      ) {
        return false;
      }

      try {
        await clearServerCartRequest(csrfToken);

        setCartError(null);

        return true;
      } catch (error) {
        console.error("Clear cart failed:", error);

        return recoverFromMutationFailure({
          error,

          userId: userIdAtStart,

          generation: generationAtStart,

          fallbackMessage: "Your cart could not be cleared.",
        });
      }
    });
  };

  /*
  |--------------------------------------------------------------------------
  | Clear local cart after logout/order conversion
  |--------------------------------------------------------------------------
  */

  const clearCart = () => {
    mutationGenerationRef.current += 1;

    commitCartItems([]);

    setCartError(null);
    setCartRefreshing(false);

    removeLegacyCartStorage();
  };

  /*
  |--------------------------------------------------------------------------
  | Get quantity
  |--------------------------------------------------------------------------
  */

  const getCartQuantity = (productId) => {
    const item = cartItems.find(
      (cartItem) => cartItem.product.id === productId,
    );

    return item?.quantity ?? 0;
  };

  /*
  |--------------------------------------------------------------------------
  | Total units
  |--------------------------------------------------------------------------
  */

  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  /*
  |--------------------------------------------------------------------------
  | Display total
  |--------------------------------------------------------------------------
  |
  | This is NOT the checkout authority.
  */

  const cartTotal = cartItems.reduce((total, item) => {
    const price = Number(item.product.price);

    if (!Number.isFinite(price)) {
      return total;
    }

    return total + price * item.quantity;
  }, 0);

  const clearCartError = () => {
    setCartError(null);
  };

  const value = {
    cartItems,
    cartCount,
    cartTotal,

    cartReady,
    cartRefreshing,
    cartError,

    refreshCart,

    addToCart,
    decreaseCartQuantity,
    removeFromCart,

    clearCart,
    clearCartOnServer,
    clearCartError,

    getCartQuantity,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used inside a CartProvider.");
  }

  return context;
}
