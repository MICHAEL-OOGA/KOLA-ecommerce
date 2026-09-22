import { Route, Routes } from "react-router-dom";

import StoreLayout from "./components/layout/StoreLayout.jsx";
import RequireAuth from "./components/auth/RequireAuth.jsx";

import HomePage from "./pages/HomePage.jsx";

import ShopPage from "./pages/public/ShopPage.jsx";
import ProductDetailsPage from "./pages/public/ProductDetailsPage.jsx";
import CartPage from "./pages/public/CartPage.jsx";

import CheckoutPage from "./pages/public/CheckoutPage.jsx";
import OrderPaymentPage from "./pages/public/OrderPaymentPage.jsx";

import LoginPage from "./pages/public/LoginPage.jsx";
import RegisterPage from "./pages/public/RegisterPage.jsx";
import VerifyEmailPage from "./pages/public/VerifyEmailPage.jsx";
import ForgotPasswordPage from "./pages/public/ForgotPasswordPage.jsx";
import ResetPasswordPage from "./pages/public/ResetPasswordPage.jsx";

import AccountPage from "./pages/public/AccountPage.jsx";
import MyOrdersPage from "./pages/public/MyOrdersPage.jsx";

import NotFoundPage from "./pages/public/NotFoundPage.jsx";

function App() {
  return (
    <Routes>
      <Route element={<StoreLayout />}>
        {/* Public */}

        <Route path="/" element={<HomePage />} />

        <Route path="/shop" element={<ShopPage />} />

        <Route path="/products/:productId" element={<ProductDetailsPage />} />

        <Route path="/cart" element={<CartPage />} />

        <Route path="/login" element={<LoginPage />} />

        <Route path="/register" element={<RegisterPage />} />

        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Authenticated customer routes */}

        <Route element={<RequireAuth />}>
          <Route path="/account" element={<AccountPage />} />

          <Route path="/account/orders" element={<MyOrdersPage />} />

          <Route path="/checkout" element={<CheckoutPage />} />

          <Route
            path="/checkout/order/:orderId"
            element={<OrderPaymentPage />}
          />
        </Route>

        {/* 404 */}

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
