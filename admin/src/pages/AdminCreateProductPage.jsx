import { useEffect, useState } from "react";

import { Link, useNavigate } from "react-router-dom";

import { createAdminProduct } from "../api/products.api.js";

import { getAdminCategories } from "../api/categories.api.js";

import { useAuth } from "../context/AuthContext.jsx";

const initialFormData = {
  name: "",
  slug: "",
  description: "",
  price: "",
  stock: "",
  imageUrl: "",
  categoryId: "",
};

const createSlug = (value) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

function AdminCreateProductPage() {
  const navigate = useNavigate();

  const { csrfToken } = useAuth();

  const [formData, setFormData] = useState(initialFormData);

  const [categories, setCategories] = useState([]);

  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const [categoriesError, setCategoriesError] = useState(null);

  const [slugWasEdited, setSlugWasEdited] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [errorMessage, setErrorMessage] = useState(null);

  const [validationErrors, setValidationErrors] = useState([]);

  const [imageFailed, setImageFailed] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Load admin categories
  |--------------------------------------------------------------------------
  |
  | This list is only for the interface.
  |
  | The backend still independently verifies categoryId
  | when the product is created.
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);

      try {
        const response = await getAdminCategories({
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setCategories(
          Array.isArray(response.categories) ? response.categories : [],
        );
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("Load categories failed:", error);

        setCategories([]);

        setCategoriesError(error?.message || "Categories could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setCategoriesLoading(false);
        }
      }
    };

    void loadCategories();

    return () => {
      controller.abort();
    };
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Image preview
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    setImageFailed(false);
  }, [formData.imageUrl]);

  /*
  |--------------------------------------------------------------------------
  | Input changes
  |--------------------------------------------------------------------------
  */

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((current) => {
      const next = {
        ...current,
        [name]: value,
      };

      if (name === "name" && !slugWasEdited) {
        next.slug = createSlug(value);
      }

      return next;
    });
  };

  const handleSlugChange = (event) => {
    setSlugWasEdited(true);

    setFormData((current) => ({
      ...current,
      slug: event.target.value,
    }));
  };

  /*
  |--------------------------------------------------------------------------
  | Submit
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    if (!csrfToken) {
      setErrorMessage(
        "Your secure administrator session is not ready. Refresh and try again.",
      );

      return;
    }

    const price = Number(formData.price);

    const stock = Number(formData.stock);

    /*
     * Frontend checks improve UX only.
     * Backend Zod validation remains authoritative.
     */

    if (!formData.price.trim() || !Number.isFinite(price) || price <= 0) {
      setErrorMessage("Enter a valid product price.");

      return;
    }

    if (!formData.stock.trim() || !Number.isSafeInteger(stock) || stock < 0) {
      setErrorMessage("Stock must be a non-negative whole number.");

      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    setValidationErrors([]);

    try {
      const response = await createAdminProduct({
        csrfToken,

        product: {
          name: formData.name.trim(),

          slug: formData.slug.trim(),

          description: formData.description.trim() || null,

          price,

          stock,

          imageUrl: formData.imageUrl.trim() || null,

          /*
           * Empty option means Uncategorized.
           *
           * We deliberately send null rather than an
           * empty string because categoryId is nullable
           * in the backend schema.
           */
          categoryId: formData.categoryId || null,

          isActive: true,
        },
      });

      navigate(`/products/${encodeURIComponent(response.product.id)}`, {
        replace: true,
      });
    } catch (error) {
      setErrorMessage(error?.message || "The product could not be created.");

      setValidationErrors(Array.isArray(error?.errors) ? error.errors : []);
    } finally {
      setSubmitting(false);
    }
  };

  const imageUrl = formData.imageUrl.trim();

  const canPreviewImage = /^https?:\/\//i.test(imageUrl) && !imageFailed;

  return (
    <main
      className="
        mx-auto
        max-w-5xl
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

      <div className="mt-7">
        <p
          className="
            text-sm
            font-black
            uppercase
            tracking-[0.16em]
            text-emerald-600
          "
        >
          Catalogue
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
          Add product
        </h1>

        <p className="mt-3 text-slate-500">
          Create a product, assign its category and set its initial inventory.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="
          mt-9
          grid
          gap-6
          xl:grid-cols-[1fr_300px]
          xl:items-start
        "
      >
        <section
          className="
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            p-6
            sm:p-8
          "
        >
          <div>
            <label
              htmlFor="name"
              className="
                text-sm
                font-black
                text-slate-700
              "
            >
              Product name
            </label>

            <input
              id="name"
              name="name"
              type="text"
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
              type="text"
              required
              maxLength={180}
              value={formData.slug}
              onChange={handleSlugChange}
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

          {/* Category */}

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
              disabled={categoriesLoading}
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
                disabled:cursor-wait
                disabled:bg-slate-50
              "
            >
              <option value="">Uncategorized</option>

              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            {categoriesLoading && (
              <p
                className="
                  mt-2
                  text-xs
                  text-slate-400
                "
              >
                Loading categories...
              </p>
            )}

            {categoriesError && (
              <p
                className="
                  mt-2
                  text-xs
                  text-amber-700
                "
              >
                {categoriesError} You can still create the product as
                Uncategorized.
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

          <div
            className="
              mt-5
              grid
              gap-5
              sm:grid-cols-2
            "
          >
            <div>
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

            <div>
              <label
                htmlFor="stock"
                className="
                  text-sm
                  font-black
                  text-slate-700
                "
              >
                Initial stock
              </label>

              <input
                id="stock"
                name="stock"
                type="number"
                min="0"
                max="1000000"
                step="1"
                required
                value={formData.stock}
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
              placeholder="https://..."
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

          {errorMessage && (
            <div
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
              <p className="font-black">{errorMessage}</p>

              {validationErrors.length > 0 && (
                <div className="mt-3 space-y-1">
                  {validationErrors.map((error, index) => (
                    <p key={`${error.field}-${index}`}>
                      {error.field}: {error.message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="
              mt-7
              w-full
              rounded-full
              bg-slate-950
              px-6
              py-4
              text-sm
              font-black
              text-white
              transition
              hover:bg-slate-800
              disabled:cursor-not-allowed
              disabled:opacity-60
            "
          >
            {submitting ? "Creating product..." : "Create product"}
          </button>
        </section>

        <aside
          className="
            rounded-[2rem]
            border
            border-slate-200
            bg-white
            p-5
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
            Preview
          </p>

          <div
            className="
              mt-4
              aspect-square
              overflow-hidden
              rounded-2xl
              bg-slate-100
            "
          >
            {canPreviewImage ? (
              <img
                src={imageUrl}
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
                  text-sm
                  font-black
                  text-slate-400
                "
              >
                No image
              </div>
            )}
          </div>

          <p
            className="
              mt-5
              break-words
              text-xl
              font-black
              text-slate-950
            "
          >
            {formData.name || "Product name"}
          </p>

          <p
            className="
              mt-2
              text-sm
              text-slate-500
            "
          >
            {formData.price ? `KES ${formData.price}` : "Price"}
          </p>

          <p
            className="
              mt-2
              text-xs
              font-bold
              text-slate-400
            "
          >
            {categories.find((category) => category.id === formData.categoryId)
              ?.name || "Uncategorized"}
          </p>
        </aside>
      </form>
    </main>
  );
}

export default AdminCreateProductPage;
