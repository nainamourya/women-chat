import type { MetadataRoute } from "next";

// Makes GiiGirl installable ("Add to Home screen"). It opens on the feed in its
// own window, without the browser bar. The middle of the maskable icon is a
// safe zone, so Android can crop it to any shape.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "GiiGirl",
    short_name: "GiiGirl",
    description: "A women-only social space. Share, message and video chat with verified women.",
    start_url: "/feed",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fff5fa",
    theme_color: "#32194a",
    categories: ["social", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Share a Gii", url: "/post/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Chats", url: "/messages", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Talk", url: "/match", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
