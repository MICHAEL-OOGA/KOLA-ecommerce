import { useEffect, useState } from "react";

import { Link } from "react-router-dom";

import { getProducts } from "../api/products.api.js";

import { getCategories } from "../api/categories.api.js";

import ProductCard from "../components/product/ProductCard.jsx";

function HomePage() {
  const [products, setProducts] = useState([]);

  const [categories, setCategories] = useState([]);

  const [isLoading, setIsLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    const loadHomeData = async () => {
      try {
        setIsLoading(true);

        const [productData, categoryData] = await Promise.all([
          getProducts({
            signal: controller.signal,
          }),

          getCategories({
            signal: controller.signal,
          }),
        ]);

        setProducts(productData);

        setCategories(categoryData);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setErrorMessage(error.message);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadHomeData();

    return () => controller.abort();
  }, []);

  return (
    <main>
      <section
        className="
          mx-auto
          max-w-7xl
          px-4
          pb-16
          pt-10
          sm:px-6
          lg:px-8
          lg:pb-24
          lg:pt-16
        "
      >
        <div
          className="
            overflow-hidden
            rounded-[2rem]
            bg-slate-950
            px-6
            py-16
            text-white
            sm:px-10
            lg:px-16
            lg:py-24
          "
        >
          <div
            className="
              max-w-3xl
            "
          >
            <span
              className="
                inline-flex
                rounded-full
                bg-white/10
                px-4
                py-2
                text-xs
                font-bold
                uppercase
                tracking-[0.2em]
                text-emerald-300
              "
            >
              New season
            </span>

            <h1
              className="
                mt-7
                max-w-3xl
                text-4xl
                font-black
                leading-[1.05]
                tracking-[-0.05em]
                sm:text-5xl
                lg:text-7xl
              "
            >
              Everyday products. Better shopping.
            </h1>

            <p
              className="
                mt-6
                max-w-xl
                text-base
                leading-7
                text-slate-300
                sm:text-lg
              "
            >
              Discover thoughtfully selected products with a simple, secure and
              effortless shopping experience.
            </p>

            <div
              className="
                mt-9
                flex
                flex-col
                gap-3
                sm:flex-row
              "
            >
              <Link
                to="/shop"
                className="
                  rounded-full
                  bg-emerald-500
                  px-7
                  py-3.5
                  text-center
                  text-sm
                  font-bold
                  text-slate-950
                  transition
                  hover:bg-emerald-400
                "
              >
                Shop collection
              </Link>

              <a
                href="#featured"
                className="
                  rounded-full
                  border
                  border-white/20
                  px-7
                  py-3.5
                  text-center
                  text-sm
                  font-bold
                  transition
                  hover:bg-white/10
                "
              >
                Explore products
              </a>
            </div>
          </div>
        </div>
      </section>

      {categories.length > 0 && (
        <section
          className="
            mx-auto
            max-w-7xl
            px-4
            pb-16
            sm:px-6
            lg:px-8
          "
        >
          <div
            className="
              flex
              flex-wrap
              gap-3
            "
          >
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="
                    rounded-full
                    border
                    border-slate-200
                    bg-white
                    px-5
                    py-2.5
                    text-sm
                    font-semibold
                    text-slate-700
                    transition
                    hover:border-slate-950
                    hover:bg-slate-950
                    hover:text-white
                  "
              >
                {category.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section
        id="featured"
        className="
          mx-auto
          max-w-7xl
          px-4
          pb-24
          sm:px-6
          lg:px-8
        "
      >
        <div
          className="
            mb-8
            flex
            items-end
            justify-between
            gap-6
          "
        >
          <div>
            <p
              className="
                text-sm
                font-bold
                uppercase
                tracking-[0.18em]
                text-emerald-600
              "
            >
              Featured
            </p>

            <h2
              className="
                mt-2
                text-3xl
                font-black
                tracking-[-0.04em]
                sm:text-4xl
              "
            >
              Popular right now
            </h2>
          </div>

          <Link
            to="/shop"
            className="
              hidden
              text-sm
              font-bold
              text-slate-600
              hover:text-slate-950
              sm:block
            "
          >
            View all →
          </Link>
        </div>

        {isLoading && (
          <div
            className="
              grid
              gap-6
              sm:grid-cols-2
              lg:grid-cols-4
            "
          >
            {Array.from({
              length: 4,
            }).map((_, index) => (
              <div
                key={index}
                className="
                    h-[420px]
                    animate-pulse
                    rounded-[1.75rem]
                    bg-slate-200
                  "
              />
            ))}
          </div>
        )}

        {!isLoading && errorMessage && (
          <div
            className="
                rounded-2xl
                border
                border-red-200
                bg-red-50
                p-6
                text-red-700
              "
          >
            {errorMessage}
          </div>
        )}

        {!isLoading && !errorMessage && (
          <div
            className="
                grid
                gap-6
                sm:grid-cols-2
                lg:grid-cols-4
              "
          >
            {products.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      <section
        className="
          border-y
          border-slate-200
          bg-white
        "
      >
        <div
          className="
            mx-auto
            grid
            max-w-7xl
            gap-8
            px-4
            py-12
            sm:px-6
            md:grid-cols-3
            lg:px-8
          "
        >
          <div>
            <h3 className="font-bold">Secure checkout</h3>

            <p
              className="
                mt-2
                text-sm
                leading-6
                text-slate-500
              "
            >
              Carefully protected payments and account activity.
            </p>
          </div>

          <div>
            <h3 className="font-bold">Simple shopping</h3>

            <p
              className="
                mt-2
                text-sm
                leading-6
                text-slate-500
              "
            >
              Clear products, pricing and checkout without unnecessary friction.
            </p>
          </div>

          <div>
            <h3 className="font-bold">M-Pesa ready</h3>

            <p
              className="
                mt-2
                text-sm
                leading-6
                text-slate-500
              "
            >
              Built around a familiar Kenyan payment experience.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

export default HomePage;
