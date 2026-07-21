import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";

const createAdmin = async () => {
  try {
    const fullName = process.env.ADMIN_FULL_NAME;
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    if (!fullName || !email || !password) {
      throw new Error("Not an admin.");
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const admin = await prisma.user.upsert({
      where: { email },
      update: {
        fullName,
        password: hashedPassword,
        role: "ADMIN",
      },

      create: {
        fullName,
        email,
        password: hashedPassword,
        role: "ADMIN",
      },
    });

    console.log("Admin user created succesfully");
    console.log({
      id: admin.id,
      fullName: admin.fullName,
      email: admin.email,
      role: admin.role,
    });
  } catch (error) {
    console.error("Failed to create admin", error.message);
  } finally {
    await prisma.$disconnect();
  }
};

createAdmin();
