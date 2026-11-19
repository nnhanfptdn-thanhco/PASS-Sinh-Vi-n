"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function HomeSearchBar() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchTerm.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    } else {
      router.push("/search");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mt-4">
      <div className="relative flex items-center bg-surface border-2 border-primary/40 focus-within:border-primary rounded-2xl shadow-card p-1.5 transition-all">
        <Search className="w-5 h-5 text-text-muted ml-3 shrink-0" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Tìm quạt đứng, nồi cơm, giáo trình giải tích..."
          className="w-full bg-transparent px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none"
        />
        <Button type="submit" variant="primary" size="md" className="rounded-xl shrink-0">
          Tìm kiếm
        </Button>
      </div>
    </form>
  );
}
