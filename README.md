<div align="center">

# 🛒 KOLA Ecommerce

### Full-Stack Ecommerce Platform with M-Pesa Integration

A secure, modern ecommerce application built with **React, Node.js, Express, PostgreSQL, Prisma and Safaricom Daraja**, featuring separate customer and administrator applications.

**KOLA v1.0**

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-06B6D4?logo=tailwindcss&logoColor=white)
![M-Pesa](https://img.shields.io/badge/M--Pesa-Daraja-00A651)

</div>

---

## 📖 Overview

**KOLA Ecommerce** is a full-stack ecommerce platform designed to demonstrate a secure and scalable online shopping architecture.

The project consists of three independent applications:

- **Customer Storefront** – product browsing, authentication, cart, checkout and order management.
- **Administrator Dashboard** – product, category and order management.
- **Backend API** – authentication, business logic, database access, security controls and M-Pesa integration.

The application uses **Safaricom Daraja STK Push** for M-Pesa checkout and implements production-minded security practices including HttpOnly cookies, CSRF protection, session revocation, rate limiting and strict server-side validation.

---

# ✨ Features

## 🛍️ Customer Storefront

Customers can:

- Browse products and categories
- Search the product catalogue
- Filter and sort products
- View individual product details
- Register an account
- Verify their email using OTP
- Log in and log out securely
- Recover forgotten passwords
- Manage their account
- Add products to their cart
- Increase or decrease cart quantities
- Receive stock-limit protection
- Persist their authenticated cart
- Proceed through checkout
- Pay using M-Pesa STK Push
- View previous orders
- Recover pending order/payment sessions
- View payment and order status

---

## 👨‍💼 Administrator Dashboard

KOLA includes a completely separate administrator application.

Administrators can:

- Sign in through a dedicated admin authentication flow
- View dashboard information
- Create products
- Update products
- View product information
- Manage product inventory
- Create and manage categories
- Assign products to categories
- View customer orders
- View individual order details
- Manage order states

The admin application is isolated from the customer storefront and uses its own authenticated session.

---

# 💳 M-Pesa Integration

KOLA integrates with **Safaricom Daraja** to provide M-Pesa checkout.

The payment system supports:

- STK Push initiation
- Customer phone payment prompts
- M-Pesa callback processing
- Payment result validation
- Order/payment reconciliation
- Pending payment recovery
- Successful payment processing
- Failed payment handling
- Server-side payment amount calculation

> The current project uses the Safaricom Daraja sandbox environment for development and testing.

The backend remains authoritative for product prices, quantities and payment totals. Payment amounts are never trusted directly from the browser.

---

# 🔐 Security

Security was a major focus during the development of KOLA.

The application includes:

- HttpOnly authentication cookies
- Separate customer and administrator sessions
- Database-backed revocable sessions
- JWT authentication
- CSRF protection
- Session-purpose validation
- Password hashing
- Email OTP verification
- Secure password-reset tokens
- Password-reset session revocation
- Rate limiting
- CORS origin allowlisting
- HTTPS enforcement support
- Helmet security headers
- Request body size limits
- Content-Type enforcement
- Zod request validation
- Server-side authorization
- Inventory protection
- Secure order state transitions
- Security audit logging
- Request ID tracing
- Sensitive URL logging protection
- Environment-variable secret management
- Production/development configuration separation

Customer and administrator authentication sessions are deliberately isolated.

For example:

```text
Customer Storefront
        │
        ▼
nova_customer_session
        │
        ▼
CUSTOMER AuthSession


Administrator App
        │
        ▼
nova_admin_session
        │
        ▼
ADMIN AuthSession


                            🏗️ Architecture

                         ┌────────────────────────┐
                         │      KOLA Ecommerce    │
                         └───────────┬────────────┘
                                     │
                   ┌─────────────────┴─────────────────┐
                   │                                   │
                   ▼                                   ▼
        ┌─────────────────────┐             ┌─────────────────────┐
        │ Customer Storefront │             │   Admin Dashboard   │
        │ React + Vite        │             │   React + Vite      │
        │ Port 5173           │             │   Port 5174         │
        └──────────┬──────────┘             └──────────┬──────────┘
                   │                                   │
                   └─────────────────┬─────────────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │    Express API      │
                          │    Node.js          │
                          │    Port 5000        │
                          └──────────┬──────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       │                           │
                       ▼                           ▼
              ┌─────────────────┐       ┌────────────────────┐
              │ Prisma ORM      │       │ Safaricom Daraja   │
              │                 │       │ M-Pesa API         │
              └────────┬────────┘       └────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ PostgreSQL      │
              │ Neon Database   │
              └─────────────────┘
