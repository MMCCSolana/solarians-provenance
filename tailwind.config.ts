import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        solana: {
          purple: "#9945ff",
          green: "#14f195",
          ink: "#0b0618"
        }
      },
      boxShadow: {
        glow: "0 0 60px rgba(153, 69, 255, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
