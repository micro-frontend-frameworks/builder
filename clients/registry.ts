import axios from "axios";

export const registry = axios.create({
  baseURL:
    process.env.NODE_ENV === "development"
      ? "http://localhost:3001/api"
      : "https://mfe-frameworks-registry.vercel.app/api",
});
