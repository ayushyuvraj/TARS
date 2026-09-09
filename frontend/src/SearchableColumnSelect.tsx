import React, { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check, Sparkles, X, Layers } from "lucide-react";
import { AlternativeMatch } from "./api_v2";

interface SearchableColumnSelectProps {
  value: string | null;
  prColumns: string[];
  suggestedColumn?: string | null;
  alternatives?: AlternativeMatch[];
  disabled?: boolean;
  onChange: (newValue: string | null) => void;
}

export const SearchableColumnSelect: React.FC<SearchableColumnSelectProps> = ({
  value,
  prColumns,
  suggestedColumn,
  alternatives = [],
  disabled = false,
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const filteredColumns = prColumns.filter((col) =>
    col.toLowerCase().includes(search.toLowerCase().trim())
  );

  const isSelectedSuggested = value && suggestedColumn && value === suggestedColumn;

  return (
    <div className="v2-combobox-wrapper" ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`v2-combobox-trigger ${isOpen ? "is-open" : ""} ${!value ? "is-unmapped" : ""}`}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          {value ? (
            <>
              {isSelectedSuggested && (
                <Sparkles size={12} style={{ color: "#a855f7", flexShrink: 0 }} />
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {value}
              </span>
            </>
          ) : (
            <span style={{ fontStyle: "italic" }}>— Unmapped (Select PR field...) —</span>
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

      {/* Floating Dropdown Popover */}
      {isOpen && (
        <div className="v2-combobox-popover">
          {/* Search Header */}
          <div className="v2-combobox-search-bar">
            <Search size={13} style={{ color: "#94a3b8", flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              className="v2-combobox-search-input"
              placeholder={`Filter ${prColumns.length} fields...`}
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
          <div className="v2-combobox-list">
            {/* Unmapped Option */}
            <button
              type="button"
              className={`v2-combobox-item ${!value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
            >
              <span style={{ fontStyle: "italic", color: "#64748b" }}>— Do not map (Ignore column) —</span>
              {!value && <Check size={13} style={{ color: "#00338d" }} />}
            </button>

            {/* AI Suggested Match */}
            {suggestedColumn &&
              (!search || suggestedColumn.toLowerCase().includes(search.toLowerCase())) && (
                <div>
                  <div className="v2-combobox-section-title" style={{ color: "#7c3aed" }}>
                    ⭐ AI Suggested Top Match
                  </div>
                  <button
                    type="button"
                    className={`v2-combobox-item is-ai-suggested ${value === suggestedColumn ? "is-selected" : ""}`}
                    onClick={() => {
                      onChange(suggestedColumn);
                      setIsOpen(false);
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {suggestedColumn}
                    </span>
                    {value === suggestedColumn && (
                      <Check size={13} style={{ color: "#6d2077", flexShrink: 0 }} />
                    )}
                  </button>
                </div>
              )}

            {/* Alternative Recommendations */}
            {alternatives.length > 0 && (
              <div>
                <div className="v2-combobox-section-title" style={{ color: "#0284c7" }}>
                  ✦ Alternative Matches
                </div>
                {alternatives
                  .filter((alt) => !search || alt.pr_column.toLowerCase().includes(search.toLowerCase()))
                  .map((alt) => (
                    <button
                      key={alt.pr_column}
                      type="button"
                      className={`v2-combobox-item ${value === alt.pr_column ? "is-selected" : ""}`}
                      onClick={() => {
                        onChange(alt.pr_column);
                        setIsOpen(false);
                      }}
                    >
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span>{alt.pr_column}</span>
                        <span style={{ marginLeft: 6, fontSize: 10, color: "#0284c7", fontFamily: "var(--v2-font-mono)" }}>
                          ({(alt.confidence * 100).toFixed(0)}%)
                        </span>
                      </div>
                      {value === alt.pr_column && (
                        <Check size={13} style={{ color: "#0284c7", flexShrink: 0 }} />
                      )}
                    </button>
                  ))}
              </div>
            )}

            {/* All PR Columns */}
            <div>
              <div className="v2-combobox-section-title">
                All Purchase Register Fields ({filteredColumns.length})
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
                      onClick={() => {
                        onChange(col);
                        setIsOpen(false);
                      }}
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
