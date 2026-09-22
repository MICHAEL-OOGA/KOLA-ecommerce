import { Route, Routes } from "react-router-dom";

import RequireAdmin from "./components/auth/RequireAdmin.jsx";

import AdminLayout from "./components/layout/AdminLayout.jsx";

import AdminDashboardPage from "./pages/AdminDashboardPage.jsx";

import AdminLoginPage from "./pages/AdminLoginPage.jsx";

import AdminOrdersPage from "./pages/AdminOrdersPage.jsx";

import AdminOrderDetailsPage from "./pages/AdminOrderDetailsPage.jsx";

import AdminProductsPage from "./pages/AdminProductsPage.jsx";

import AdminCreateProductPage from "./pages/AdminCreateProductPage.jsx";

import AdminProductDetailsPage from "./pages/AdminProductDetailsPage.jsx";

import AdminCategoriesPage from "./pages/AdminCategoriesPage.jsx";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<AdminLoginPage />} />

      <Route
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route path="/" element={<AdminDashboardPage />} />
        <Route path="/orders" element={<AdminOrdersPage />} />
        <Route path="/orders/:orderId" element={<AdminOrderDetailsPage />} />
        <Route path="/products" element={<AdminProductsPage />} />
        <Route path="/products/new" element={<AdminCreateProductPage />} />
        <Route
          path="/products/:productId"
          element={<AdminProductDetailsPage />}
        />
        <Route path="/categories" element={<AdminCategoriesPage />} />a{" "}
      </Route>
    </Routes>
  );
}

export default App;
