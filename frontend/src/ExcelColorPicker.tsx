import React, { useState, useEffect, useRef, useMemo } from "react";
import "./excel_color_picker.css";
import { Palette, Check, X, ChevronDown } from "lucide-react";

// --- OFFICE 365 THEME COLOR PALETTE CONSTANTS ---
export const EXCEL_THEME_BASE_ROW = [
  "#FFFFFF", // White
  "#000000", // Black
  "#E7E6E6", // Light Gray / Background 2
  "#44546A", // Dark Slate Gray / Text 2
  "#4472C4", // Accent 1 Blue
  "#ED7D31", // Accent 2 Orange
  "#A5A5A5", // Accent 3 Gray
  "#FFC000", // Accent 4 Gold/Yellow
  "#5B9BD5", // Accent 5 Cerulean Blue
  "#70AD47", // Accent 6 Olive Green
];

// 5 rows of 10 tints/shades matching Excel 365
export const EXCEL_THEME_TINTS_ROWS = [
  // Row 1: Lighter 80% / Darker 25%
  [
    "#F2F2F2", "#7F7F7F", "#D0CECE", "#D6DCE4", "#D9E1F2",
    "#FCE4D6", "#EDEDED", "#FFF2CC", "#DDEBF7", "#E2EFDA"
  ],
  // Row 2: Lighter 60% / Darker 50%
  [
    "#D9D9D9", "#595959", "#AEAAAA", "#ACB9CA", "#B4C6E7",
    "#F8CBAD", "#DBDBDB", "#FEE699", "#BDD7EE", "#C6E0B4"
  ],
  // Row 3: Lighter 40%
  [
    "#BFBFBF", "#3F3F3F", "#757171", "#8497B0", "#8EA9DB",
    "#F4B084", "#C9C9C9", "#FFD966", "#9BC2E6", "#A9D08E"
  ],
  // Row 4: Darker 25%
  [
    "#A6A6A6", "#262626", "#3A3838", "#2F3B4C", "#305496",
    "#C65911", "#7B7B7B", "#BF8F00", "#2E75B6", "#548235"
  ],
  // Row 5: Darker 50%
  [
    "#7F7F7F", "#0C0C0C", "#161616", "#1F2733", "#203764",
    "#833C0C", "#525252", "#7F6000", "#1F4E78", "#375623"
  ]
];

// 10 Standard Excel Colors
export const EXCEL_STANDARD_COLORS = [
  "#C00000", // Dark Red
  "#FF0000", // Red
  "#FFC000", // Orange
  "#FFFF00", // Yellow
  "#92D050", // Light Green
  "#00B050", // Green
  "#00B0F0", // Light Blue
  "#0070C0", // Blue
  "#002060", // Dark Navy
  "#7030A0", // Purple
];

// --- COLOR MATH CONVERSIONS ---
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6) return { r: 255, g: 255, b: 255 };
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toH = (v: number) => clamp(v).toString(16).padStart(2, "0").toUpperCase();
  return `#${toH(r)}${toH(g)}${toH(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// --- HONEYCOMB HEXAGON GENERATOR ---
interface HexCell {
  q: number;
  r: number;
  x: number;
  y: number;
  color: string;
}

function generateHoneycombCells(): { cells: HexCell[]; grayCells: HexCell[] } {
  const cells: HexCell[] = [];
  const radius = 9.0;
  const sqrt3 = Math.sqrt(3);
  const centerX = 115;
  const centerY = 100;
  const rings = 6;

  // Center hexagon = White
  cells.push({ q: 0, r: 0, x: centerX, y: centerY, color: "#FFFFFF" });

  for (let ring = 1; ring <= rings; ring++) {
    // 6 directions in axial coordinates
    const directions = [
      { dq: 1, dr: 0 },
      { dq: 0, dr: 1 },
      { dq: -1, dr: 1 },
      { dq: -1, dr: 0 },
      { dq: 0, dr: -1 },
      { dq: 1, dr: -1 },
    ];

    // Start at corner
    let q = directions[4].dq * ring;
    let r = directions[4].dr * ring;

    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        // Pointy-topped hexagon pixel coordinates
        const px = centerX + radius * (sqrt3 * q + (sqrt3 / 2) * r);
        const py = centerY + radius * ((3 / 2) * r);

        // Compute angle around center
        const angle = Math.atan2(py - centerY, px - centerX) * (180 / Math.PI);
        const hue = (angle + 360) % 360;

        // Saturation & Lightness radiating from center
        const sat = Math.min(100, 45 + ring * 9);
        const lit = Math.max(30, 95 - ring * 9.5);
        const rgb = hslToRgb(hue, sat, lit);
        const color = rgbToHex(rgb.r, rgb.g, rgb.b);

        cells.push({ q, r, x: px, y: py, color });

        q += directions[side].dq;
        r += directions[side].dr;
      }
    }
  }

  // Bottom Grayscale Strip
  const grayCells: HexCell[] = [];
  const graySteps = [
    "#FFFFFF", "#EDEDED", "#DBDBDB", "#C9C9C9", "#B7B7B7",
    "#A5A5A5", "#939393", "#818181", "#6F6F6F", "#5D5D5D",
    "#4B4B4B", "#393939", "#272727", "#151515", "#000000"
  ];
  const startX = 15;
  const grayY = 202;
  const stepW = 14;

  graySteps.forEach((c, idx) => {
    grayCells.push({
      q: idx,
      r: 99,
      x: startX + idx * stepW,
      y: grayY,
      color: c,
    });
  });

  return { cells, grayCells };
}

// --- PROPS ---
interface ExcelColorPickerProps {
  color?: string;
  onChange: (hex: string) => void;
  label?: string;
  allowNoFill?: boolean;
}

export const ExcelColorPicker: React.FC<ExcelColorPickerProps> = ({
  color = "#00338D",
  onChange,
  label,
  allowNoFill = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"standard" | "custom">("standard");

  // State inside "Colors" Modal
  const [tempColor, setTempColor] = useState<string>(color || "#00338D");
  const initialColorRef = useRef<string>(color || "#00338D");

  // Custom Tab State
  const [rgbState, setRgbState] = useState(() => hexToRgb(color || "#00338D"));
  const [luminance, setLuminance] = useState<number>(50); // 0 to 100
  const [currentHue, setCurrentHue] = useState<number>(0);
  const [openUpward, setOpenUpward] = useState<boolean>(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);

  // Detect available space to auto-flip dropdown upward when near bottom
  useEffect(() => {
    if (isOpen && popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < 290) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
    }
  }, [isOpen]);

  // Sync initial color
  useEffect(() => {
    if (color) {
      setTempColor(color);
      setRgbState(hexToRgb(color));
      const hsl = rgbToHsl(hexToRgb(color).r, hexToRgb(color).g, hexToRgb(color).b);
      setCurrentHue(hsl.h);
      setLuminance(hsl.l);
    }
  }, [color]);

  // Click outside to close popover
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  // Draw 2D Spectrum Canvas
  useEffect(() => {
    if (isModalOpen && activeTab === "custom" && spectrumRef.current) {
      const canvas = spectrumRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // Draw horizontal Hue gradient
      const hueGrad = ctx.createLinearGradient(0, 0, width, 0);
      hueGrad.addColorStop(0, "rgb(255, 0, 0)");
      hueGrad.addColorStop(0.17, "rgb(255, 255, 0)");
      hueGrad.addColorStop(0.33, "rgb(0, 255, 0)");
      hueGrad.addColorStop(0.5, "rgb(0, 255, 255)");
      hueGrad.addColorStop(0.67, "rgb(0, 0, 255)");
      hueGrad.addColorStop(0.83, "rgb(255, 0, 255)");
      hueGrad.addColorStop(1, "rgb(255, 0, 0)");
      ctx.fillStyle = hueGrad;
      ctx.fillRect(0, 0, width, height);

      // Draw vertical Saturation/Brightness overlay
      const vertGrad = ctx.createLinearGradient(0, 0, 0, height);
      vertGrad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      vertGrad.addColorStop(0.5, "rgba(255, 255, 255, 0)");
      vertGrad.addColorStop(0.5, "rgba(0, 0, 0, 0)");
      vertGrad.addColorStop(1, "rgba(0, 0, 0, 0.95)");
      ctx.fillStyle = vertGrad;
      ctx.fillRect(0, 0, width, height);
    }
  }, [isModalOpen, activeTab]);

  // Honeycomb data
  const { cells: honeycombCells, grayCells } = useMemo(() => generateHoneycombCells(), []);

  // Handle Pick from Popover
  const handleQuickPick = (hex: string) => {
    onChange(hex);
    setIsOpen(false);
  };

  // Open "More Colors..." Modal
  const openColorsDialog = () => {
    initialColorRef.current = color || "#00338D";
    setTempColor(color || "#00338D");
    setIsOpen(false);
    setIsModalOpen(true);
  };

  // Handle RGB number inputs
  const handleRgbChange = (channel: "r" | "g" | "b", val: number) => {
    const clamped = Math.max(0, Math.min(255, isNaN(val) ? 0 : val));
    const nextRgb = { ...rgbState, [channel]: clamped };
    setRgbState(nextRgb);
    const hex = rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b);
    setTempColor(hex);
  };

  // Handle Spectrum Canvas Click
  const handleSpectrumClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = spectrumRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvas.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));

    const hue = (x / canvas.width) * 360;
    const sat = 100;
    const lit = Math.round(100 - (y / canvas.height) * 100);

    setCurrentHue(hue);
    setLuminance(lit);

    const rgb = hslToRgb(hue, sat, lit);
    setRgbState(rgb);
    setTempColor(rgbToHex(rgb.r, rgb.g, rgb.b));
  };

  // Commit Dialog
  const handleDialogOk = () => {
    onChange(tempColor);
    setIsModalOpen(false);
  };

  // Cancel Dialog
  const handleDialogCancel = () => {
    setTempColor(initialColorRef.current);
    setIsModalOpen(false);
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }} ref={popoverRef}>
      {/* Trigger Button */}
      <button
        type="button"
        className="excel-picker-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        title={label || "Choose Color"}
      >
        <div
          className="excel-picker-trigger__swatch"
          style={{ backgroundColor: color || "transparent" }}
        />
        <span style={{ fontSize: 11, color: "#334155" }}>
          {color ? color.toUpperCase() : "None"}
        </span>
        <ChevronDown size={12} color="#64748b" />
      </button>

      {/* POPUP: Excel Theme Colors Palette (Screenshot 1) */}
      {isOpen && (
        <div className={`excel-color-dropdown ${openUpward ? "open-upward" : ""}`}>
          {/* Section: Theme Colors */}
          <div className="excel-color-section-title">Theme Colors</div>

          {/* 10-Column Grid */}
          <div className="excel-theme-grid">
            {/* Header Row (Base 10 Colors) */}
            {EXCEL_THEME_BASE_ROW.map((hex, i) => (
              <div
                key={`base-${i}`}
                className={`excel-swatch-box ${color?.toUpperCase() === hex.toUpperCase() ? "selected" : ""}`}
                style={{ backgroundColor: hex }}
                onClick={() => handleQuickPick(hex)}
                title={hex}
              />
            ))}

            {/* 5 Rows of Tints & Shades */}
            {EXCEL_THEME_TINTS_ROWS.map((row, rIdx) =>
              row.map((hex, cIdx) => (
                <div
                  key={`tint-${rIdx}-${cIdx}`}
                  className={`excel-swatch-box ${color?.toUpperCase() === hex.toUpperCase() ? "selected" : ""}`}
                  style={{ backgroundColor: hex }}
                  onClick={() => handleQuickPick(hex)}
                  title={hex}
                />
              ))
            )}
          </div>

          {/* Section: Standard Colors */}
          <div className="excel-color-section-title">Standard Colors</div>
          <div className="excel-theme-grid" style={{ gridTemplateRows: "19px", marginBottom: 6 }}>
            {EXCEL_STANDARD_COLORS.map((hex, i) => (
              <div
                key={`std-${i}`}
                className={`excel-swatch-box ${color?.toUpperCase() === hex.toUpperCase() ? "selected" : ""}`}
                style={{ backgroundColor: hex }}
                onClick={() => handleQuickPick(hex)}
                title={hex}
              />
            ))}
          </div>

          <div className="excel-color-divider" />

          {/* Optional "No Fill" */}
          {allowNoFill && (
            <div
              className="excel-color-action-item"
              onClick={() => handleQuickPick("")}
            >
              <div
                className="excel-color-action-item__icon-wrap"
                style={{ border: "1px dashed #94a3b8", borderRadius: 2 }}
              >
                <X size={12} color="#64748b" />
              </div>
              <span>No Fill</span>
            </div>
          )}

          {/* "More Colors..." Trigger Button */}
          <div
            className="excel-color-action-item"
            onClick={openColorsDialog}
            style={{ fontWeight: 600 }}
          >
            <div className="excel-color-action-item__icon-wrap">
              <Palette size={14} color="#00338D" />
            </div>
            <span>More Colors...</span>
          </div>
        </div>
      )}

      {/* DIALOG: Authentic Excel "Colors" Modal (Screenshots 2 & 4) */}
      {isModalOpen && (
        <div className="excel-dialog-overlay">
          <div className="excel-dialog-window">
            {/* Header */}
            <div className="excel-dialog-header">
              <span className="excel-dialog-title">Colors</span>
              <button className="excel-dialog-close" onClick={handleDialogCancel}>
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="excel-dialog-tabs">
              <button
                type="button"
                className={`excel-dialog-tab-btn ${activeTab === "standard" ? "active" : ""}`}
                onClick={() => setActiveTab("standard")}
              >
                Standard
              </button>
              <button
                type="button"
                className={`excel-dialog-tab-btn ${activeTab === "custom" ? "active" : ""}`}
                onClick={() => setActiveTab("custom")}
              >
                Custom
              </button>
            </div>

            {/* Dialog Content */}
            <div className="excel-dialog-body">
              {/* Left Panel: Honeycomb or Custom Spectrum */}
              <div className="excel-dialog-left">
                {activeTab === "standard" ? (
                  // TAB 1: Honeycomb / Hexagonal Palette (Screenshot 2)
                  <div className="excel-honeycomb-container">
                    <svg width="230" height="230" viewBox="0 0 230 230">
                      {/* Hexagon Cells */}
                      {honeycombCells.map((cell, idx) => {
                        const r = 5.2;
                        const sqrt3 = Math.sqrt(3);
                        // 6 vertices of pointy-topped hexagon
                        const pts = [
                          `${cell.x},${cell.y - r}`,
                          `${cell.x + (sqrt3 / 2) * r},${cell.y - r / 2}`,
                          `${cell.x + (sqrt3 / 2) * r},${cell.y + r / 2}`,
                          `${cell.x},${cell.y + r}`,
                          `${cell.x - (sqrt3 / 2) * r},${cell.y + r / 2}`,
                          `${cell.x - (sqrt3 / 2) * r},${cell.y - r / 2}`,
                        ].join(" ");

                        const isSelected = tempColor.toUpperCase() === cell.color.toUpperCase();

                        return (
                          <g key={`hex-${idx}`}>
                            <polygon
                              points={pts}
                              fill={cell.color}
                              className="excel-hex-cell"
                              onClick={() => {
                                setTempColor(cell.color);
                                setRgbState(hexToRgb(cell.color));
                              }}
                            />
                            {isSelected && (
                              <circle
                                cx={cell.x}
                                cy={cell.y}
                                r={4.5}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth="1.5"
                                style={{ pointerEvents: "none" }}
                              />
                            )}
                          </g>
                        );
                      })}

                      {/* Bottom Grayscale Strip */}
                      {grayCells.map((cell, idx) => {
                        const isSelected = tempColor.toUpperCase() === cell.color.toUpperCase();
                        return (
                          <g key={`gray-${idx}`}>
                            <rect
                              x={cell.x}
                              y={cell.y}
                              width={12}
                              height={12}
                              fill={cell.color}
                              stroke="#cbd5e1"
                              strokeWidth="0.5"
                              style={{ cursor: "pointer" }}
                              onClick={() => {
                                setTempColor(cell.color);
                                setRgbState(hexToRgb(cell.color));
                              }}
                            />
                            {isSelected && (
                              <rect
                                x={cell.x - 1}
                                y={cell.y - 1}
                                width={14}
                                height={14}
                                fill="none"
                                stroke="#00338D"
                                strokeWidth="1.5"
                                style={{ pointerEvents: "none" }}
                              />
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                ) : (
                  // TAB 2: Custom Spectrum + RGB Spinners (Screenshot 4)
                  <div className="excel-custom-tab-container">
                    <div className="excel-spectrum-row">
                      {/* 2D Gradient Canvas */}
                      <div className="excel-spectrum-canvas-wrap">
                        <canvas
                          ref={spectrumRef}
                          width={190}
                          height={120}
                          onClick={handleSpectrumClick}
                        />
                      </div>
                    </div>

                    {/* Numeric RGB & Hex Fields */}
                    <div className="excel-numeric-fields-grid">
                      <span>Red:</span>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        className="excel-input-field"
                        value={rgbState.r}
                        onChange={(e) => handleRgbChange("r", parseInt(e.target.value))}
                      />

                      <span>Green:</span>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        className="excel-input-field"
                        value={rgbState.g}
                        onChange={(e) => handleRgbChange("g", parseInt(e.target.value))}
                      />

                      <span>Blue:</span>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        className="excel-input-field"
                        value={rgbState.b}
                        onChange={(e) => handleRgbChange("b", parseInt(e.target.value))}
                      />

                      <span>Hex:</span>
                      <input
                        type="text"
                        maxLength={7}
                        className="excel-input-field"
                        value={tempColor}
                        onChange={(e) => {
                          let val = e.target.value;
                          if (!val.startsWith("#")) val = "#" + val;
                          setTempColor(val);
                          if (val.length === 7) {
                            setRgbState(hexToRgb(val));
                          }
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Right Panel: Split Preview & Actions */}
              <div className="excel-dialog-right">
                {/* Actions: OK / Cancel */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    type="button"
                    className="excel-dialog-btn-ok"
                    onClick={handleDialogOk}
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    className="excel-dialog-btn-cancel"
                    onClick={handleDialogCancel}
                  >
                    Cancel
                  </button>
                </div>

                {/* Comparison Preview (New vs Current) */}
                <div className="excel-preview-box-container">
                  <span>New</span>
                  <div className="excel-preview-swatch-split">
                    <div
                      className="excel-preview-swatch-split__new"
                      style={{ backgroundColor: tempColor || "transparent" }}
                    />
                    <div
                      className="excel-preview-swatch-split__current"
                      style={{ backgroundColor: initialColorRef.current || "transparent" }}
                    />
                  </div>
                  <span style={{ marginTop: 2 }}>Current</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
