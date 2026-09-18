import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, Check, Sparkles, X, Link2, Unlink, Lock } from "lucide-react";
import { AlternativeMatchV3 } from "./api_v3";

interface SearchableColumnSelectV3Props {
  currentColumn: string;
  value: string | null;
  allColumns: string[];
  partnerLockedBy?: string | null;
  alternatives?: AlternativeMatchV3[];
  disabled?: boolean;
  onChange: (newValue: string | null) => void;
  onUnlink?: () => void;
}

export const SearchableColumnSelectV3: React.FC<SearchableColumnSelectV3Props> = ({
  currentColumn,
  value,
  allColumns = [],
  partnerLockedBy,
  alternatives = [],
  disabled = false,
  onChange,
  onUnlink,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Exclude current column from dropdown so only the remaining N - 1 columns appear
  const availableColumns = useMemo(() => {
    return allColumns.filter((col) => col !== currentColumn);
  }, [allColumns, currentColumn]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const filteredColumns = useMemo(() => {
    if (!search.trim()) return availableColumns;
    const q = search.toLowerCase().trim();
    return availableColumns.filter((col) => col.toLowerCase().includes(q));
  }, [availableColumns, search]);

  const handleSelect = (colName: string | null) => {
    onChange(colName);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <div className="v2-combobox-wrapper" ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {/* Trigger Button */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(!isOpen)}
          className={`v2-combobox-trigger ${isOpen ? "is-open" : ""} ${!value ? "is-unmapped" : ""}`}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: value ? "rgba(0, 51, 141, 0.04)" : "#ffffff",
            borderColor: value ? "#00338d" : "rgba(0, 51, 141, 0.2)",
          }}
          title={value ? `Symmetrically coupled with '${value}' (Click to re-assign)` : "Select partner column"}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
            {value ? (
              <>
                <Link2 size={13} style={{ color: "#00338d", flexShrink: 0 }} />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: 600,
                    color: "#00338d",
                  }}
                >
                  {value}
                </span>
                {partnerLockedBy && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#6d2077",
                      background: "rgba(109, 32, 119, 0.08)",
                      padding: "1px 5px",
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                  >
                    Mutual Pair
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontStyle: "italic", color: "#64748b" }}>
                — Unmapped (Select from {availableColumns.length} fields...) —
              </span>
            )}
          </div>
          <ChevronDown
            size={14}
            style={{
              color: isOpen ? "#0091da" : "#94a3b8",
              flexShrink: 0,
              transform: isOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          />
        </button>

        {value && !disabled && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onUnlink) {
                onUnlink();
              } else {
                handleSelect(null);
              }
            }}
            title={`Unlink '${currentColumn}' and '${value}'`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid rgba(239, 68, 68, 0.3)",
              background: "rgba(239, 68, 68, 0.06)",
              color: "#dc2626",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.15s ease",
            }}
          >
            <Unlink size={13} />
          </button>
        )}
      </div>

      {/* Floating Dropdown Popover */}
      {isOpen && (
        <div
          className="v2-combobox-popover"
          style={{
            zIndex: 9999,
            minWidth: 320,
            maxWidth: 420,
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          }}
        >
          {/* Search Header */}
          <div className="v2-combobox-search-bar">
            <Search size={13} style={{ color: "#94a3b8", flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              className="v2-combobox-search-input"
              placeholder={`Filter remaining ${availableColumns.length} columns...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 0 }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* List Options */}
          <div className="v2-combobox-list" style={{ maxHeight: 300, overflowY: "auto" }}>
            {/* Unmapped Option */}
            <button
              type="button"
              className={`v2-combobox-item ${!value ? "is-selected" : ""}`}
              onClick={() => handleSelect(null)}
            >
              <span style={{ fontStyle: "italic", color: "#dc2626" }}>— Leave Unmapped / Standalone —</span>
              {!value && <Check size={13} style={{ color: "#00338d" }} />}
            </button>

            {/* Smart Suggested Alternatives */}
            {alternatives && alternatives.length > 0 && (
              <div>
                <div className="v2-combobox-section-title" style={{ color: "#7c3aed" }}>
                  ⭐ Recommended Candidate Matches
                </div>
                {alternatives
                  .filter((alt) => {
                    const altTarget = alt.target_column || (alt as any).pr_column || "";
                    if (!altTarget || altTarget === currentColumn) return false;
                    if (search && !altTarget.toLowerCase().includes(search.toLowerCase())) return false;
                    return true;
                  })
                  .map((alt) => {
                    const targetName = alt.target_column || (alt as any).pr_column;
                    const isSelected = value === targetName;
                    return (
                      <button
                        key={targetName}
                        type="button"
                        className={`v2-combobox-item is-ai-suggested ${isSelected ? "is-selected" : ""}`}
                        onClick={() => handleSelect(targetName)}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {targetName}
                          </span>
                          <span style={{ fontSize: 10, color: "#7c3aed", fontFamily: "var(--v2-font-mono)", flexShrink: 0, marginLeft: 8 }}>
                            {(alt.confidence * 100).toFixed(0)}% &bull; {alt.reason || "Smart Match"}
                          </span>
                        </div>
                        {isSelected && <Check size={13} style={{ color: "#6d2077", flexShrink: 0, marginLeft: 6 }} />}
                      </button>
                    );
                  })}
              </div>
            )}

            {/* All Remaining N - 1 Columns */}
            <div>
              <div className="v2-combobox-section-title">
                All Columns in Sheet ({filteredColumns.length} of {availableColumns.length})
              </div>
              {filteredColumns.length === 0 ? (
                <div style={{ padding: "12px 10px", textAlign: "center", color: "#94a3b8", fontStyle: "italic", fontSize: 11.5 }}>
                  No columns found matching "{search}"
                </div>
              ) : (
                filteredColumns.map((col) => {
                  const isSelected = value === col;
                  return (
                    <button
                      key={col}
                      type="button"
                      className={`v2-combobox-item ${isSelected ? "is-selected" : ""}`}
                      onClick={() => handleSelect(col)}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {col}
                      </span>
                      {isSelected && <Check size={13} style={{ color: "#00338d", flexShrink: 0 }} />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
