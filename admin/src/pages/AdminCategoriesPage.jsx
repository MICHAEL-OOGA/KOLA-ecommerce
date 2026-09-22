import { useEffect, useState } from "react";

import {
  createAdminCategory,
  deleteAdminCategory,
  getAdminCategories,
  updateAdminCategory,
} from "../api/categories.api.js";

import { useAuth } from "../context/AuthContext.jsx";

const createSlug = (value) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

function AdminCategoriesPage() {
  const { csrfToken } = useAuth();

  const [categories, setCategories] = useState([]);

  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);

  const [createForm, setCreateForm] = useState({
    name: "",
    slug: "",
  });

  const [createSlugEdited, setCreateSlugEdited] = useState(false);

  const [creating, setCreating] = useState(false);

  const [createError, setCreateError] = useState(null);

  const [createMessage, setCreateMessage] = useState(null);

  const [editingId, setEditingId] = useState(null);

  const [editForm, setEditForm] = useState({
    name: "",
    slug: "",
  });

  const [savingEdit, setSavingEdit] = useState(false);

  const [editError, setEditError] = useState(null);

  const [deletingId, setDeletingId] = useState(null);

  const [actionError, setActionError] = useState(null);

  /*
  |--------------------------------------------------------------------------
  | Load categories
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const controller = new AbortController();

    const loadCategories = async () => {
      setLoading(true);
      setLoadError(null);

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

        console.error("Admin categories failed:", error);

        setCategories([]);

        setLoadError(error?.message || "Categories could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadCategories();

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  /*
  |--------------------------------------------------------------------------
  | Create category
  |--------------------------------------------------------------------------
  */

  const handleCreateNameChange = (event) => {
    const value = event.target.value;

    setCreateForm((current) => ({
      ...current,

      name: value,

      slug: createSlugEdited ? current.slug : createSlug(value),
    }));
  };

  const handleCreateSlugChange = (event) => {
    setCreateSlugEdited(true);

    setCreateForm((current) => ({
      ...current,
      slug: event.target.value,
    }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();

    if (creating) {
      return;
    }

    if (!csrfToken) {
      setCreateError("Your secure administrator session is not ready.");

      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreateMessage(null);

    try {
      const response = await createAdminCategory({
        csrfToken,

        category: {
          name: createForm.name.trim(),

          slug: createForm.slug.trim(),
        },
      });

      setCreateForm({
        name: "",
        slug: "",
      });

      setCreateSlugEdited(false);

      setCreateMessage(response.message || "Category created successfully.");

      setReloadKey((current) => current + 1);
    } catch (error) {
      setCreateError(error?.message || "Category could not be created.");
    } finally {
      setCreating(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Editing
  |--------------------------------------------------------------------------
  */

  const beginEdit = (category) => {
    setEditingId(category.id);

    setEditForm({
      name: category.name,
      slug: category.slug,
    });

    setEditError(null);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);

    setEditForm({
      name: "",
      slug: "",
    });

    setEditError(null);
  };

  const handleEditSave = async (categoryId) => {
    if (savingEdit) {
      return;
    }

    if (!csrfToken) {
      setEditError("Your secure administrator session is not ready.");

      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      await updateAdminCategory({
        categoryId,
        csrfToken,

        updates: {
          name: editForm.name.trim(),

          slug: editForm.slug.trim(),
        },
      });

      cancelEdit();

      setReloadKey((current) => current + 1);
    } catch (error) {
      setEditError(error?.message || "Category could not be updated.");
    } finally {
      setSavingEdit(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Delete
  |--------------------------------------------------------------------------
  */

  const handleDelete = async (category) => {
    if (deletingId || !csrfToken) {
      return;
    }

    /*
     * This is only a UX check.
     * The backend independently enforces CATEGORY_NOT_EMPTY.
     */
    if (category._count?.products > 0) {
      setActionError(
        `"${category.name}" still contains products. Reassign those products before deleting the category.`,
      );

      return;
    }

    const confirmed = window.confirm(`Delete "${category.name}" permanently?`);

    if (!confirmed) {
      return;
    }

    setDeletingId(category.id);

    setActionError(null);

    try {
      await deleteAdminCategory({
        categoryId: category.id,

        csrfToken,
      });

      setReloadKey((current) => current + 1);
    } catch (error) {
      setActionError(error?.message || "Category could not be deleted.");

      /*
       * Relationship state may have changed while
       * the administrator had this page open.
       */
      if ([404, 409].includes(error?.status)) {
        setReloadKey((current) => current + 1);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const totalCategories = categories.length;

  const usedCategories = categories.filter(
    (category) => (category._count?.products ?? 0) > 0,
  ).length;

  const emptyCategories = totalCategories - usedCategories;

  return (
    <main
      className="
        mx-auto
        max-w-7xl
        px-5
        py-10
        sm:px-8
        lg:py-12
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
          Categories
        </h1>

        <p
          className="
            mt-3
            max-w-2xl
            text-slate-500
          "
        >
          Organize products into clear storefront groups.
        </p>
      </div>

      {!loading && !loadError && (
        <section
          className="
              mt-10
              grid
              gap-4
              sm:grid-cols-3
            "
        >
          {[
            ["Total categories", totalCategories],
            ["In use", usedCategories],
            ["Empty", emptyCategories],
          ].map(([label, value]) => (
            <article
              key={label}
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
                      text-sm
                      font-bold
                      text-slate-500
                    "
              >
                {label}
              </p>

              <p
                className="
                      mt-4
                      text-3xl
                      font-black
                      text-slate-950
                    "
              >
                {value}
              </p>
            </article>
          ))}
        </section>
      )}

      <div
        className="
          mt-8
          grid
          gap-6
          xl:grid-cols-[340px_1fr]
          xl:items-start
        "
      >
        {/* Create */}

        <form
          onSubmit={handleCreate}
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
              tracking-[0.14em]
              text-emerald-600
            "
          >
            New category
          </p>

          <h2
            className="
              mt-2
              text-2xl
              font-black
              text-slate-950
            "
          >
            Add category
          </h2>

          <div className="mt-6">
            <label
              htmlFor="category-name"
              className="
                text-sm
                font-black
                text-slate-700
              "
            >
              Name
            </label>

            <input
              id="category-name"
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={createForm.name}
              onChange={handleCreateNameChange}
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
              htmlFor="category-slug"
              className="
                text-sm
                font-black
                text-slate-700
              "
            >
              Slug
            </label>

            <input
              id="category-slug"
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={createForm.slug}
              onChange={handleCreateSlugChange}
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

          {createMessage && (
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
              {createMessage}
            </p>
          )}

          {createError && (
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
              {createError}
            </p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="
              mt-6
              w-full
              rounded-full
              bg-slate-950
              px-5
              py-3.5
              text-sm
              font-black
              text-white
              disabled:opacity-60
            "
          >
            {creating ? "Creating..." : "Create category"}
          </button>
        </form>

        {/* Category list */}

        <section
          className="
            overflow-hidden
            rounded-[2rem]
            border
            border-slate-200
            bg-white
          "
        >
          {loading && (
            <div className="p-8 text-slate-500">Loading categories...</div>
          )}

          {!loading && loadError && (
            <div className="p-8">
              <p
                className="
                    font-black
                    text-red-700
                  "
              >
                {loadError}
              </p>

              <button
                type="button"
                onClick={() => setReloadKey((current) => current + 1)}
                className="
                    mt-5
                    rounded-full
                    bg-slate-950
                    px-5
                    py-3
                    text-sm
                    font-black
                    text-white
                  "
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !loadError && categories.length === 0 && (
            <div
              className="
                  p-12
                  text-center
                  text-slate-500
                "
            >
              No categories yet.
            </div>
          )}

          {actionError && (
            <div
              className="
                m-5
                rounded-2xl
                bg-red-50
                p-4
                text-sm
                text-red-700
              "
            >
              {actionError}
            </div>
          )}

          {!loading &&
            !loadError &&
            categories.map((category) => {
              const editing = editingId === category.id;

              const productCount = category._count?.products ?? 0;

              return (
                <article
                  key={category.id}
                  className="
                      border-b
                      border-slate-100
                      p-6
                      last:border-b-0
                    "
                >
                  {editing ? (
                    <div>
                      <div
                        className="
                            grid
                            gap-4
                            md:grid-cols-2
                          "
                      >
                        <input
                          value={editForm.name}
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          maxLength={80}
                          className="
                              rounded-2xl
                              border
                              border-slate-200
                              px-4
                              py-3
                              outline-none
                              focus:border-slate-950
                            "
                        />

                        <input
                          value={editForm.slug}
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              slug: event.target.value,
                            }))
                          }
                          maxLength={100}
                          className="
                              rounded-2xl
                              border
                              border-slate-200
                              px-4
                              py-3
                              outline-none
                              focus:border-slate-950
                            "
                        />
                      </div>

                      {editError && (
                        <p
                          className="
                              mt-4
                              text-sm
                              text-red-600
                            "
                        >
                          {editError}
                        </p>
                      )}

                      <div
                        className="
                            mt-4
                            flex
                            gap-2
                          "
                      >
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => handleEditSave(category.id)}
                          className="
                              rounded-full
                              bg-slate-950
                              px-5
                              py-2.5
                              text-sm
                              font-black
                              text-white
                              disabled:opacity-50
                            "
                        >
                          {savingEdit ? "Saving..." : "Save"}
                        </button>

                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingEdit}
                          className="
                              rounded-full
                              border
                              border-slate-200
                              px-5
                              py-2.5
                              text-sm
                              font-black
                              text-slate-600
                            "
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="
                          flex
                          flex-col
                          gap-5
                          sm:flex-row
                          sm:items-center
                          sm:justify-between
                        "
                    >
                      <div>
                        <h2
                          className="
                              text-lg
                              font-black
                              text-slate-950
                            "
                        >
                          {category.name}
                        </h2>

                        <p
                          className="
                              mt-1
                              text-sm
                              text-slate-400
                            "
                        >
                          {category.slug}
                        </p>

                        <p
                          className="
                              mt-2
                              text-xs
                              font-bold
                              text-slate-500
                            "
                        >
                          {productCount} product
                          {productCount === 1 ? "" : "s"}
                        </p>
                      </div>

                      <div
                        className="
                            flex
                            flex-wrap
                            gap-2
                          "
                      >
                        <button
                          type="button"
                          onClick={() => beginEdit(category)}
                          className="
                              rounded-full
                              border
                              border-slate-200
                              px-5
                              py-2.5
                              text-sm
                              font-black
                              text-slate-700
                            "
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          disabled={
                            deletingId === category.id || productCount > 0
                          }
                          onClick={() => handleDelete(category)}
                          className="
                              rounded-full
                              bg-red-50
                              px-5
                              py-2.5
                              text-sm
                              font-black
                              text-red-600
                              disabled:cursor-not-allowed
                              disabled:opacity-40
                            "
                        >
                          {deletingId === category.id
                            ? "Deleting..."
                            : productCount > 0
                              ? "In use"
                              : "Delete"}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
        </section>
      </div>
    </main>
  );
}

export default AdminCategoriesPage;
