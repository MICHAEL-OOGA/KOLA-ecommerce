import { useEffect, useState } from "react";

import { Link, useParams } from "react-router-dom";

import {
  deactivateAdminProduct,
  getAdminProductById,
  updateAdminProduct,
  updateAdminProductStock,
} from "../api/products.api.js";

import { useAuth } from "../context/AuthContext.jsx";

import { getAdminCategories } from "../api/categories.api.js";

const formatCurrency = (value) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "KSh 0.00";
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
  }).format(numericValue);
};

function AdminProductDetailsPage() {
  const { productId } = useParams();

  const { csrfToken } = useAuth();

  const [product, setProduct] = useState(null);

  const [formData, setFormData] = useState(null);

  const [stockInput, setStockInput] = useState("");

  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState(null);

  const [savingProduct, setSavingProduct] = useState(false);

  const [savingStock, setSavingStock] = useState(false);

  const [changingStatus, setChangingStatus] = useState(false);

  const [productMessage, setProductMessage] = useState(null);

  const [productError, setProductError] = useState(null);

  const [stockMessage, setStockMessage] = useState(null);

  const [stockError, setStockError] = useState(null);

  const [statusMessage, setStatusMessage] = useState(null);

  const [statusError, setStatusError] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  const [imageFailed, setImageFailed] = useState(false);

  const [categories, setCategories] = useState([]);

  const [categoriesError, setCategoriesError] = useState(null);

  /*
  |--------------------------------------------------------------------------
  | Load authoritative product
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!productId) {
      return;
    }

    const controller = new AbortController();

    const loadProduct = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const response = await getAdminProductById(productId, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        const [productResponse, categoriesResponse] = await Promise.all([
          getAdminProductById(productId, {
            signal: controller.signal,
          }),

          getAdminCategories({
            signal: controller.signal,
          }),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        const loaded = productResponse.product;

        setProduct(loaded);

        setCategories(
          Array.isArray(categoriesResponse.categories)
            ? categoriesResponse.categories
            : [],
        );

        setCategoriesError(null);

        setFormData({
          name: loaded.name || "",

          slug: loaded.slug || "",

          description: loaded.description || "",

          price: String(loaded.price ?? ""),

          imageUrl: loaded.imageUrl || "",

          /*
           * React <select> works cleanly with ""
           * representing Uncategorized.
           */
          categoryId: loaded.categoryId || "",
        });

        setStockInput(String(loaded.stock ?? 0));

        setImageFailed(false);
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        setProduct(null);

        setLoadError(
          error?.status === 404
            ? "This product could not be found."
            : error?.message || "Product could not be loaded.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadProduct();

    return () => {
      controller.abort();
    };
  }, [productId, reloadKey]);

  /*
  |--------------------------------------------------------------------------
  | Catalogue form
  |--------------------------------------------------------------------------
  */

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));

    if (name === "imageUrl") {
      setImageFailed(false);
    }
  };

  const handleProductSave = async (event) => {
    event.preventDefault();

    if (savingProduct || !product || !formData) {
      return;
    }

    if (!csrfToken) {
      setProductError("Your secure administrator session is not ready.");

      return;
    }

    const price = Number(formData.price);

    if (!formData.price.trim() || !Number.isFinite(price) || price <= 0) {
      setProductError("Enter a valid product price.");

      return;
    }

    setSavingProduct(true);
    setProductError(null);
    setProductMessage(null);

    try {
      const response = await updateAdminProduct({
        productId: product.id,

        csrfToken,

        updates: {
          name: formData.name.trim(),

          slug: formData.slug.trim(),

          description: formData.description.trim() || null,

          price,

          imageUrl: formData.imageUrl.trim() || null,

          categoryId: formData.categoryId || null,
        },
      });

      const updated = response.product;

      setProduct(updated);

      setFormData({
        name: updated.name || "",

        slug: updated.slug || "",

        description: updated.description || "",

        price: String(updated.price ?? ""),

        imageUrl: updated.imageUrl || "",

        categoryId: updated.categoryId || "",
      });

      setProductMessage(response.message || "Product updated successfully.");
    } catch (error) {
      setProductError(error?.message || "Product could not be updated.");
    } finally {
      setSavingProduct(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Inventory update
  |--------------------------------------------------------------------------
  */

  const handleStockSave = async (event) => {
    event.preventDefault();

    if (savingStock || !product) {
      return;
    }

    if (!csrfToken) {
      setStockError("Your secure administrator session is not ready.");

      return;
    }

    const newStock = Number(stockInput);

    if (
      !stockInput.trim() ||
      !Number.isSafeInteger(newStock) ||
      newStock < 0 ||
      newStock > 1_000_000
    ) {
      setStockError("Stock must be a whole number between 0 and 1,000,000.");

      return;
    }

    setSavingStock(true);
    setStockError(null);
    setStockMessage(null);

    try {
      const response = await updateAdminProductStock({
        productId: product.id,

        expectedCurrentStock: product.stock,

        stock: newStock,

        csrfToken,
      });

      setProduct(response.product);

      setStockInput(String(response.product.stock));

      setStockMessage(response.message || "Inventory updated successfully.");
    } catch (error) {
      if (error?.code === "PRODUCT_STOCK_CHANGED") {
        const currentStock = error?.data?.currentStock;

        setStockError(
          Number.isSafeInteger(currentStock)
            ? `Inventory changed while you were editing. Current database stock is ${currentStock}. The product will now be refreshed.`
            : "Inventory changed while you were editing. The product will now be refreshed.",
        );

        setReloadKey((current) => current + 1);

        return;
      }

      setStockError(error?.message || "Inventory could not be updated.");
    } finally {
      setSavingStock(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Activate / deactivate
  |--------------------------------------------------------------------------
  */

  const handleStatusChange = async () => {
    if (changingStatus || !product) {
      return;
    }

    if (!csrfToken) {
      setStatusError("Your secure administrator session is not ready.");

      return;
    }

    const activating = !product.isActive;

    if (!activating) {
      const confirmed = window.confirm(
        "Deactivate this product? It will disappear from the customer storefront but its historical records will remain.",
      );

      if (!confirmed) {
        return;
      }
    }

    setChangingStatus(true);
    setStatusError(null);
    setStatusMessage(null);

    try {
      const response = activating
        ? await updateAdminProduct({
            productId: product.id,

            csrfToken,

            updates: {
              isActive: true,
            },
          })
        : await deactivateAdminProduct({
            productId: product.id,

            csrfToken,
          });

      setProduct(response.product);

      setStatusMessage(
        response.message ||
          (activating
            ? "Product activated successfully."
            : "Product deactivated successfully."),
      );
    } catch (error) {
      setStatusError(error?.message || "Product status could not be changed.");

      /*
       * Reload authoritative state after a conflict/error
       * where the product may have changed.
       */
      if ([400, 404, 409].includes(error?.status)) {
        setReloadKey((current) => current + 1);
      }
    } finally {
      setChangingStatus(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Loading
  |--------------------------------------------------------------------------
  */

  if (loading) {
    return (
      <main
        className="
          mx-auto
          max-w-6xl
          px-5
          py-10
          sm:px-8
        "
      >
        <div className="animate-pulse">
          <div className="h-5 w-24 rounded bg-slate-200" />

          <div className="mt-5 h-12 w-72 rounded bg-slate-200" />

          <div className="mt-10 h-96 rounded-[2rem] bg-slate-100" />
        </div>
      </main>
    );
  }

  if (loadError || !product || !formData) {
    return (
      <main
        className="
          mx-auto
          max-w-6xl
          px-5
          py-10
          sm:px-8
        "
      >
        <Link
          to="/products"
          className="
            text-sm
            font-black
            text-slate-500
          "
        >
          ← Products
        </Link>

        <div
          className="
            mt-8
            rounded-[2rem]
            bg-red-50
            p-7
          "
        >
          <h1
            className="
              text-2xl
              font-black
              text-red-800
            "
          >
            Product unavailable
          </h1>

          <p className="mt-2 text-red-700">{loadError}</p>
        </div>
      </main>
    );
  }

  const usableImage =
    Boolean(formData.imageUrl.trim()) &&
    /^https?:\/\//i.test(formData.imageUrl.trim()) &&
    !imageFailed;

  return (
    <main
      className="
        mx-auto
        max-w-6xl
        px-5
        py-10
        sm:px-8
        lg:py-12
      "
    >
      <Link
        to="/products"
        className="
          text-sm
          font-black
          text-slate-500
          transition
          hover:text-slate-950
        "
      >
        ← Products
      </Link>

      <div
        className="
          mt-7
          flex
          flex-col
          gap-5
          sm:flex-row
          sm:items-end
          sm:justify-between
        "
      >
        <div>
          <p
            className="
              text-sm
              font-black
              uppercase
              tracking-[0.16em]
              text-emerald-600
            "
          >
            Product management
          </p>

          <h1
            className="
              mt-2
              text-4xl
              font-black
              tracking-[-0.05em]
              text-slate-950
              sm:text-5xl
            "
          >
            {product.name}
          </h1>

          <p
            className="
              mt-3
              text-sm
              text-slate-500
            "
          >
            {product.id}
          </p>
        </div>

        <span
          className={`
            self-start
            rounded-full
            px-4
            py-2
            text-xs
            font-black
            uppercase
            tracking-wider

            ${
              product.isActive
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-200 text-slate-600"
            }
          `}
        >
          {product.isActive ? "Active" : "Inactive"}
        </span>
      </div>

      <div
        className="
          mt-9
          grid
          gap-6
          xl:grid-cols-[1fr_330px]
          xl:items-start
        "
      >
        <div className="space-y-6">
          {/* Catalogue information */}

          <form
            onSubmit={handleProductSave}
            className="
              rounded-[2rem]
              border
              border-slate-200
              bg-white
              p-6
              sm:p-8
            "
          >
            <h2
              className="
                text-2xl
                font-black
                text-slate-950
              "
            >
              Product information
            </h2>

            <p
              className="
                mt-2
                text-sm
                text-slate-500
              "
            >
              Stock is managed separately below.
            </p>

            <div className="mt-7">
              <label
                htmlFor="name"
                className="
                  text-sm
                  font-black
                  text-slate-700
                "
              >
                Name
              </label>

              <input
                id="name"
                name="name"
                required
                maxLength={150}
                value={formData.name}
                onChange={handleChange}
                className="
                  mt-2
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  px-4
                  py-3.5
                  outline-none
                  focus:border-slate-950
                "
              />
            </div>

            <div className="mt-5">
              <label
                htmlFor="slug"
                className="
                  text-sm
                  font-black
                  text-slate-700
                "
              >
                Slug
              </label>

              <input
                id="slug"
                name="slug"
                required
                maxLength={180}
                value={formData.slug}
                onChange={handleChange}
                className="
                  mt-2
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  px-4
                  py-3.5
                  outline-none
                  focus:border-slate-950
                "
              />
            </div>

            <div className="mt-5">
              <label
                htmlFor="categoryId"
                className="
      text-sm
      font-black
      text-slate-700
    "
              >
                Category
              </label>

              <select
                id="categoryId"
                name="categoryId"
                value={formData.categoryId}
                onChange={handleChange}
                className="
      mt-2
      w-full
      rounded-2xl
      border
      border-slate-200
      bg-white
      px-4
      py-3.5
      outline-none
      focus:border-slate-950
    "
              >
                <option value="">Uncategorized</option>

                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>

              {categoriesError && (
                <p
                  className="
        mt-2
        text-xs
        text-red-600
      "
                >
                  {categoriesError}
                </p>
              )}
            </div>

            <div className="mt-5">
              <label
                htmlFor="description"
                className="
                  text-sm
                  font-black
                  text-slate-700
                "
              >
                Description
              </label>

              <textarea
                id="description"
                name="description"
                rows={7}
                maxLength={5000}
                value={formData.description}
                onChange={handleChange}
                className="
                  mt-2
                  w-full
                  resize-y
                  rounded-2xl
                  border
                  border-slate-200
                  px-4
                  py-3.5
                  outline-none
                  focus:border-slate-950
                "
              />
            </div>

            <div className="mt-5">
              <label
                htmlFor="price"
                className="
                  text-sm
                  font-black
                  text-slate-700
                "
              >
                Price (KES)
              </label>

              <input
                id="price"
                name="price"
                type="number"
                min="0.01"
                max="99999999.99"
                step="0.01"
                required
                value={formData.price}
                onChange={handleChange}
                className="
                  mt-2
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  px-4
                  py-3.5
                  outline-none
                  focus:border-slate-950
                "
              />
            </div>

            <div className="mt-5">
              <label
                htmlFor="imageUrl"
                className="
                  text-sm
                  font-black
                  text-slate-700
                "
              >
                Image URL
              </label>

              <input
                id="imageUrl"
                name="imageUrl"
                type="url"
                maxLength={2048}
                value={formData.imageUrl}
                onChange={handleChange}
                className="
                  mt-2
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  px-4
                  py-3.5
                  outline-none
                  focus:border-slate-950
                "
              />
            </div>

            {productMessage && (
              <p
                className="
                  mt-6
                  rounded-2xl
                  bg-emerald-50
                  p-4
                  text-sm
                  text-emerald-700
                "
              >
                {productMessage}
              </p>
            )}

            {productError && (
              <p
                role="alert"
                className="
                  mt-6
                  rounded-2xl
                  bg-red-50
                  p-4
                  text-sm
                  text-red-700
                "
              >
                {productError}
              </p>
            )}

            <button
              type="submit"
              disabled={savingProduct}
              className="
                mt-7
                rounded-full
                bg-slate-950
                px-6
                py-3.5
                text-sm
                font-black
                text-white
                disabled:opacity-60
              "
            >
              {savingProduct ? "Saving..." : "Save product information"}
            </button>
          </form>

          {/* Inventory */}

          <form
            onSubmit={handleStockSave}
            className="
              rounded-[2rem]
              border
              border-slate-200
              bg-white
              p-6
              sm:p-8
            "
          >
            <p
              className="
                text-xs
                font-black
                uppercase
                tracking-[0.15em]
                text-emerald-600
              "
            >
              Protected inventory
            </p>

            <h2
              className="
                mt-2
                text-2xl
                font-black
                text-slate-950
              "
            >
              Stock
            </h2>

            <p
              className="
                mt-2
                max-w-xl
                text-sm
                leading-6
                text-slate-500
              "
            >
              The update will only succeed if database stock is still{" "}
              <strong>{product.stock}</strong>. If a customer changes inventory
              first, KOLA rejects this update.
            </p>

            <div
              className="
                mt-6
                flex
                flex-col
                gap-3
                sm:flex-row
              "
            >
              <input
                type="number"
                min="0"
                max="1000000"
                step="1"
                required
                value={stockInput}
                onChange={(event) => setStockInput(event.target.value)}
                className="
                  w-full
                  rounded-2xl
                  border
                  border-slate-200
                  px-4
                  py-3.5
                  outline-none
                  focus:border-slate-950
                  sm:max-w-xs
                "
              />

              <button
                type="submit"
                disabled={savingStock}
                className="
                  rounded-2xl
                  bg-slate-950
                  px-6
                  py-3.5
                  text-sm
                  font-black
                  text-white
                  disabled:opacity-60
                "
              >
                {savingStock ? "Updating..." : "Update stock"}
              </button>
            </div>

            {stockMessage && (
              <p
                className="
                  mt-5
                  rounded-2xl
                  bg-emerald-50
                  p-4
                  text-sm
                  text-emerald-700
                "
              >
                {stockMessage}
              </p>
            )}

            {stockError && (
              <p
                role="alert"
                className="
                  mt-5
                  rounded-2xl
                  bg-red-50
                  p-4
                  text-sm
                  text-red-700
                "
              >
                {stockError}
              </p>
            )}
          </form>
        </div>

        <aside className="space-y-6">
          {/* Preview */}

          <section
            className="
              rounded-[2rem]
              border
              border-slate-200
              bg-white
              p-5
            "
          >
            <div
              className="
                aspect-square
                overflow-hidden
                rounded-2xl
                bg-slate-100
              "
            >
              {usableImage ? (
                <img
                  src={formData.imageUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="
                    h-full
                    w-full
                    object-cover
                  "
                />
              ) : (
                <div
                  className="
                    flex
                    h-full
                    items-center
                    justify-center
                    font-black
                    text-slate-400
                  "
                >
                  KOLA
                </div>
              )}
            </div>

            <h2
              className="
                mt-5
                text-xl
                font-black
                text-slate-950
              "
            >
              {formData.name}
            </h2>

            <p
              className="
                mt-2
                text-lg
                font-black
                text-slate-700
              "
            >
              {formatCurrency(formData.price)}
            </p>

            <p
              className="
                mt-2
                text-sm
                text-slate-500
              "
            >
              Stock: {product.stock}
            </p>
          </section>

          {/* Visibility */}

          <section
            className={`
              rounded-[2rem]
              p-6

              ${
                product.isActive
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white"
              }
            `}
          >
            <p
              className={`
                text-xs
                font-black
                uppercase
                tracking-[0.15em]

                ${product.isActive ? "text-emerald-400" : "text-slate-400"}
              `}
            >
              Storefront
            </p>

            <h2
              className="
                mt-3
                text-xl
                font-black
              "
            >
              {product.isActive ? "Product is active" : "Product is inactive"}
            </h2>

            <p
              className={`
                mt-2
                text-sm
                leading-6

                ${product.isActive ? "text-slate-400" : "text-slate-500"}
              `}
            >
              {product.isActive
                ? "Customers can currently discover this product."
                : "The product remains in the database but is hidden from customers."}
            </p>

            {statusMessage && (
              <p
                className="
                  mt-5
                  rounded-2xl
                  bg-emerald-50
                  p-4
                  text-sm
                  text-emerald-700
                "
              >
                {statusMessage}
              </p>
            )}

            {statusError && (
              <p
                className="
                  mt-5
                  rounded-2xl
                  bg-red-50
                  p-4
                  text-sm
                  text-red-700
                "
              >
                {statusError}
              </p>
            )}

            <button
              type="button"
              disabled={changingStatus}
              onClick={handleStatusChange}
              className={`
                mt-6
                w-full
                rounded-full
                px-5
                py-3.5
                text-sm
                font-black
                transition
                disabled:opacity-60

                ${
                  product.isActive
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "bg-slate-950 text-white hover:bg-slate-800"
                }
              `}
            >
              {changingStatus
                ? "Updating..."
                : product.isActive
                  ? "Deactivate product"
                  : "Reactivate product"}
            </button>
          </section>

          {/* Category */}

          <section
            className="
              rounded-[2rem]
              border
              border-slate-200
              bg-white
              p-6
            "
          >
            <p
              className="
                text-xs
                font-black
                uppercase
                tracking-wider
                text-slate-400
              "
            >
              Saved Category
            </p>

            <p
              className="
                mt-3
                font-black
                text-slate-950
              "
            >
              {product.category?.name || "Uncategorized"}
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default AdminProductDetailsPage;
