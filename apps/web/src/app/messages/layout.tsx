import { MessagesProvider } from "@/lib/social/MessagesProvider";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return <MessagesProvider>{children}</MessagesProvider>;
}
