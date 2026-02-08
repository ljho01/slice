import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts/AppContext";
import { useI18n } from "@/contexts/I18nContext";
import { Disc3, FolderOpen, Home, Settings } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const tabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/packs", label: "Packs", icon: FolderOpen },
  { to: "/sounds", label: "Sounds", icon: Disc3 },
] as const;

export default function NavRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { lastSoundsSearch } = useApp();
  const { t } = useI18n();
  const path = location.pathname;

  const isSettingsActive = path.startsWith("/settings");

  return (
    <nav className="w-16 h-full pl-3 pt-8 pb-3">
      <div className="border flex flex-col bg-card gap-2 pt-5 items-center rounded-xl">
        {/* Logo */}
        <div className="pb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="6" width="4" height="12" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.7" />
            <rect x="8" y="3" width="4" height="18" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.5" />
            <rect x="14" y="8" width="4" height="8" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.7" />
            <rect x="20" y="5" width="4" height="14" rx="2" fill="hsl(var(--muted-foreground))" opacity="0.5" />
          </svg>
        </div>

        {/* Tabs */}
        <div className="flex flex-col gap-1">
          {tabs.map(({ to, label, icon: Icon }) => {
            const isActive =
              to === "/" ? path === "/" : path.startsWith(to);

            return (
              <Tooltip key={to}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (to === "/sounds") {
                        navigate({ to: "/sounds", search: lastSoundsSearch });
                      } else {
                        navigate({ to });
                      }
                    }}
                    className={cn(
                      "flex items-center justify-center rounded-lg p-2.5 w-[40px] h-[40px] transition-colors cursor-pointer",
                      isActive
                        ? "bg-muted-foreground/15 text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon size={20} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Settings */}
        <div className="pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                className={cn(
                  "flex items-center justify-center rounded-lg p-2.5 w-[40px] h-[40px] transition-colors",
                  isSettingsActive
                    ? "bg-muted-foreground/15 text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Settings size={20} />
              </Link>
            </TooltipTrigger>
            <TooltipContent>{t("nav.settings")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </nav>
  );
}
