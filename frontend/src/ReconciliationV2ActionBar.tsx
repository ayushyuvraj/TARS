import React from "react";
import { ArrowLeft, ArrowRight, Activity } from "lucide-react";

export interface StageActionBarProps {
  position?: "top" | "bottom";
  stageNumber?: number;
  backLabel?: string;
  onBack?: () => void;
  backDisabled?: boolean;
  nextLabel?: string;
  onNext?: () => void;
  nextDisabled?: boolean;
  isNextLoading?: boolean;
  nextLoadingText?: string;
  nextIcon?: React.ReactNode;
  extraLeft?: React.ReactNode;
  extraRight?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const ReconciliationV2ActionBar: React.FC<StageActionBarProps> = ({
  position = "bottom",
  stageNumber,
  backLabel,
  onBack,
  backDisabled = false,
  nextLabel,
  onNext,
  nextDisabled = false,
  isNextLoading = false,
  nextLoadingText = "Processing…",
  nextIcon,
  extraLeft,
  extraRight,
  style,
  className = "",
}) => {
  return (
    <div
      className={`v2-stage-action-bar ${position} ${className}`}
      style={style}
    >
      {/* Left Action Area */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onBack && backLabel ? (
          <button
            type="button"
            className="btn-secondary-v2"
            onClick={onBack}
            disabled={backDisabled}
            title={backLabel}
          >
            <ArrowLeft size={16} />
            <span>{backLabel}</span>
          </button>
        ) : (
          extraLeft || <div />
        )}
      </div>

      {/* Right Action Area */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {extraRight}

        {onNext && nextLabel && (
          <button
            type="button"
            className="btn-primary-v2"
            onClick={onNext}
            disabled={nextDisabled || isNextLoading}
            title={nextLabel}
          >
            {isNextLoading ? (
              <>
                <Activity className="spin" size={16} />
                <span>{nextLoadingText}</span>
              </>
            ) : (
              <>
                <span>{nextLabel}</span>
                {nextIcon !== undefined ? nextIcon : <ArrowRight size={16} />}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
