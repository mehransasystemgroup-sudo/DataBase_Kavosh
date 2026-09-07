import { Toaster as Sonner, toast } from "sonner";
import { useTheme } from "@/context/ThemeContext";

/** نان‌آور پیام‌ها — رنگ‌هایش از توکن‌های تم می‌آید، نه از پالت خودش. */
function Toaster(props) {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      dir="rtl"
      position="top-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast font-sans group-[.toaster]:bg-surface group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-panel group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-brand group-[.toast]:text-brand-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:text-ok",
          error: "group-[.toaster]:text-err",
          warning: "group-[.toaster]:text-warn",
          info: "group-[.toaster]:text-info",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
