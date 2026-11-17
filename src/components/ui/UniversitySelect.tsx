"use client";

import * as React from "react";
import {
  Search,
  Check,
  ChevronDown,
  X,
  GraduationCap,
  MapPin,
  Building2,
} from "lucide-react";
import { cn, removeVietnameseTones } from "@/lib/utils";
import universitiesData from "../../../data/universities_vietnam.json";

export interface UniversityItem {
  code: string;
  name: string;
  shortName: string;
  provinceCode: string;
  wardCode: string;
  address: string;
  campuses: Array<{
    id: string;
    name: string;
    provinceCode: string;
    wardCode: string;
    address: string;
  }>;
  emailDomains: string[];
  dorms: string[];
}

export interface UniversitySelectProps {
  value?: string;
  onChange: (schoolCode: string, school?: UniversityItem) => void;
  label?: string;
  placeholder?: string;
  error?: string;
  helperText?: string;
  className?: string;
  disabled?: boolean;
  allowAll?: boolean;
  allLabel?: string;
}

export const UniversitySelect: React.FC<UniversitySelectProps> = ({
  value,
  onChange,
  label = "Trường Đại học / Cao đẳng / Học viện *",
  placeholder = "Gõ để tìm kiếm (vd: FPT, Bách Khoa, Kinh Tế, HUST...)",
  error,
  helperText,
  className,
  disabled = false,
  allowAll = false,
  allLabel = "Tất cả các trường toàn quốc",
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selectedSchool = React.useMemo(() => {
    if (!value || (allowAll && value === "all")) return null;
    return (universitiesData as UniversityItem[]).find((s) => s.code === value) || null;
  }, [value, allowAll]);

  // Lọc thông minh: Hỗ trợ tiếng Việt có dấu, không dấu, tên viết tắt, mã trường, địa chỉ
  const filteredSchools = React.useMemo(() => {
    const rawQuery = searchQuery.trim();
    if (!rawQuery) {
      return universitiesData as UniversityItem[];
    }

    const cleanQuery = removeVietnameseTones(rawQuery).toLowerCase();
    const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);

    return (universitiesData as UniversityItem[]).filter((school) => {
      const cleanName = removeVietnameseTones(school.name).toLowerCase();
      const cleanShort = removeVietnameseTones(school.shortName).toLowerCase();
      const cleanCode = school.code.toLowerCase();
      const cleanAddr = removeVietnameseTones(school.address).toLowerCase();

      // Kiểm tra tất cả từ khóa tìm kiếm (AND search)
      return queryTokens.every(
        (token) =>
          cleanName.includes(token) ||
          cleanShort.includes(token) ||
          cleanCode.includes(token) ||
          cleanAddr.includes(token)
      );
    });
  }, [searchQuery]);

  // Click outside listener
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Reset highlight index when filtered list changes
  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  // Tự cuộn mục đang chọn vào tầm nhìn
  React.useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleOpen = () => {
    if (disabled) return;
    setIsOpen(true);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleSelect = (code: string) => {
    const found = (universitiesData as UniversityItem[]).find(
      (s) => s.code === code
    );
    onChange(code, found);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    const totalCount =
      filteredSchools.length + (allowAll && !searchQuery.trim() ? 1 : 0);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % Math.max(1, totalCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev <= 0 ? Math.max(0, totalCount - 1) : prev - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (allowAll && !searchQuery.trim() && highlightedIndex === 0) {
        onChange("all");
        setIsOpen(false);
        setSearchQuery("");
      } else {
        const schoolIndex =
          allowAll && !searchQuery.trim()
            ? highlightedIndex - 1
            : highlightedIndex;
        const target = filteredSchools[schoolIndex];
        if (target) {
          handleSelect(target.code);
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full space-y-1.5", className)}>
      {label && (
        <label className="block text-sm font-medium text-text-main">
          {label}
        </label>
      )}

      {/* Button kích hoạt Combobox / Khung hiển thị trường hiện tại */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleOpen();
          }
        }}
        className={cn(
          "w-full min-h-[46px] px-3.5 py-2 bg-surface border rounded-xl flex items-center justify-between gap-2.5 cursor-pointer transition-all",
          "hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent",
          isOpen ? "ring-2 ring-primary border-transparent" : "border-surface-border",
          error && "border-red-500 focus:ring-red-500",
          disabled && "opacity-50 cursor-not-allowed bg-surface-muted"
        )}
      >
        <div className="flex items-center gap-2.5 overflow-hidden text-left flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <GraduationCap className="w-4 h-4" />
          </div>

          <div className="flex-1 min-w-0">
            {selectedSchool ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-text-main truncate">
                  {selectedSchool.name}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-primary/15 text-primary border border-primary/20 shrink-0">
                  {selectedSchool.shortName}
                </span>
              </div>
            ) : allowAll && value === "all" ? (
              <span className="text-sm font-semibold text-text-main">
                {allLabel}
              </span>
            ) : (
              <span className="text-sm text-text-muted">
                -- Chọn trường đại học / cao đẳng --
              </span>
            )}

            {selectedSchool && (
              <div className="flex items-center gap-1 text-[11px] text-text-muted truncate mt-0.5">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{selectedSchool.address}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 text-text-muted">
          {selectedSchool && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleOpen();
                setSearchQuery("");
              }}
              className="p-1 hover:text-text-main rounded-md transition-colors"
              title="Thay đổi trường"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
          <ChevronDown
            className={cn(
              "w-4 h-4 transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        </div>
      </div>

      {/* DROPDOWN POPOVER */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-surface border border-surface-border rounded-xl shadow-xl overflow-hidden backdrop-blur-md animate-in fade-in-50 zoom-in-95 duration-150">
          {/* Ô gõ tìm kiếm bên trong dropdown */}
          <div className="p-2.5 border-b border-surface-border bg-surface-muted/60">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-text-muted absolute left-3 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full h-10 pl-9 pr-9 bg-surface border border-surface-border rounded-lg text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    inputRef.current?.focus();
                  }}
                  className="absolute right-2.5 p-1 text-text-muted hover:text-text-main rounded-md transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Hint & Badge đếm số lượng */}
            <div className="flex items-center justify-between px-1 mt-2 text-[11px] text-text-muted">
              <span>
                {searchQuery
                  ? `Tìm thấy ${filteredSchools.length} trường phù hợp`
                  : `Tổng cộng ${universitiesData.length} trường trên toàn quốc`}
              </span>
              <span className="text-[10px] bg-surface px-1.5 py-0.5 rounded border border-surface-border">
                ESC để đóng
              </span>
            </div>
          </div>

          {/* Danh sách các trường có thể cuộn */}
          <ul
            ref={listRef}
            className="max-h-64 overflow-y-auto divide-y divide-surface-border/50 py-1"
          >
            {/* Tùy chọn 'Tất cả các trường' nếu allowAll = true */}
            {allowAll && !searchQuery.trim() && (
              <li
                onClick={() => {
                  onChange("all");
                  setIsOpen(false);
                  setSearchQuery("");
                }}
                className={cn(
                  "px-3.5 py-2.5 flex items-center justify-between cursor-pointer transition-colors text-sm",
                  highlightedIndex === 0
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-surface-muted text-text-main",
                  value === "all" && "bg-primary/5 text-primary font-semibold"
                )}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-text-muted" />
                  <span>{allLabel}</span>
                </div>
                {value === "all" && <Check className="w-4 h-4 text-primary" />}
              </li>
            )}

            {filteredSchools.length === 0 ? (
              <li className="px-4 py-8 text-center text-xs text-text-muted space-y-1">
                <p className="font-semibold text-text-main">
                  Không tìm thấy trường nào phù hợp với &ldquo;{searchQuery}&rdquo;
                </p>
                <p>
                  Thử tìm theo tên viết tắt (vd: FPT, BK, HUST, UEH, DUT) hoặc tỉnh thành.
                </p>
              </li>
            ) : (
              filteredSchools.map((school, idx) => {
                const adjustedIdx =
                  allowAll && !searchQuery.trim() ? idx + 1 : idx;
                const isSelected = value === school.code;
                const isHighlighted = highlightedIndex === adjustedIdx;

                return (
                  <li
                    key={school.code}
                    onClick={() => handleSelect(school.code)}
                    onMouseEnter={() => setHighlightedIndex(adjustedIdx)}
                    className={cn(
                      "px-3.5 py-2.5 cursor-pointer transition-colors flex items-start justify-between gap-3 text-left",
                      isHighlighted
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-surface-muted text-text-main",
                      isSelected && "bg-primary/5 font-semibold"
                    )}
                  >
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium leading-snug">
                          {school.name}
                        </span>
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[11px] font-bold border shrink-0",
                            isSelected || isHighlighted
                              ? "bg-primary/20 text-primary border-primary/30"
                              : "bg-surface-muted text-text-secondary border-surface-border"
                          )}
                        >
                          {school.shortName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{school.address}</span>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400 font-medium">
          {error}
        </p>
      ) : helperText ? (
        <p className="text-xs text-text-muted">{helperText}</p>
      ) : null}
    </div>
  );
};

export default UniversitySelect;
