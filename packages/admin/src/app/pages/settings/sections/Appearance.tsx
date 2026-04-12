// Import Dependencies
import { Label, Radio, RadioGroup } from "@headlessui/react";
import clsx from "clsx";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Callout } from "@radix-ui/themes";

// Local Imports
import { useThemeContext } from "@/app/contexts/theme/context";
import { colors } from "@/constants/colors";
import { Listbox } from "@/components/shared/form/StyledListbox";
import { useDidUpdate } from "@/hooks";
import { Button, Switch } from "@/components/ui";
import {
  PrimaryColor,
  LightColor,
  DarkColor,
  Notification,
} from "@/configs/@types/theme";
import { useActiveThemeModule } from "@/hooks/useActiveThemeModule";

// ----------------------------------------------------------------------

const primaryColors: PrimaryColor[] = [
  "pink",
  "red",
  "crimson",
  "orange",
  "amber",
  "green",
  "cyan",
  "teal",
  "blue",
  "indigo",
  "violet",
  "purple",
  "plum",
  "rose",
];
const lightColors: LightColor[] = ["slate", "gray", "neutral"];
const darkColors: DarkColor[] = ["mint", "navy", "mirage", "cinder", "black"];

const cardSkins = [
  {
    value: "shadow",
    label: "Shadow",
  },
  {
    value: "bordered",
    label: "Bordered",
  },
];

const notificationPos: {
  value: Notification["position"];
  label: string;
}[] = [
  {
    value: "top-left",
    label: "Top Left",
  },
  {
    value: "top-center",
    label: "Top Center",
  },
  {
    value: "top-right",
    label: "Top Right",
  },
  {
    value: "bottom-left",
    label: "Bottom Left",
  },
  {
    value: "bottom-center",
    label: "Bottom Center",
  },
  {
    value: "bottom-right",
    label: "Bottom Right",
  },
];

const MAX_NOTIFICATION_COUNT = 5;

export default function Appearance() {
  const theme = useThemeContext();
  const activeTheme = useActiveThemeModule();
  const adminOverrides = activeTheme?.themeOverrides.admin;

  useDidUpdate(() => {
    const currentPosition = notificationPos.find(
      (pos) => pos.value === theme.notification?.position,
    );

    if (currentPosition) {
      toast("Position updated", {
        description: `Notification position updated to ${currentPosition.label}`,
        descriptionClassName: "text-gray-600 text-xs mt-0.5",
      });
    }
  }, [theme.notification?.position]);

  useDidUpdate(() => {
    for (let i = 0; i < 3; i++) toast("This is a Toast");
  }, [theme.notification?.isExpanded]);

  return (
    <div className="w-full max-w-3xl 2xl:max-w-5xl">
      <h5 className="text-lg font-medium text-[var(--gray-12)]">
        Appearance
      </h5>
      <p className="mt-0.5 text-sm text-balance text-[var(--gray-11)]">
        Customize notification preferences and display settings.
      </p>

      {activeTheme && adminOverrides && (
        <Callout.Root color="blue" className="mt-4">
          <Callout.Icon>
            <Lock className="h-4 w-4" />
          </Callout.Icon>
          <Callout.Text>
            The <strong>{activeTheme.name}</strong> theme module is managing admin appearance settings like color scheme and layout.
          </Callout.Text>
        </Callout.Root>
      )}

      <div className="my-5 h-px bg-[var(--gray-a4)]" />

      {/* Theme selection disabled - using fixed gradient background theme */}
      <div className="space-y-8 hidden">
        <div>
          <div>
            <p className="text-base font-medium text-[var(--gray-12)]">
              Theme
            </p>
            <p className="mt-0.5">
              You can select a theme color from the list below.
            </p>
          </div>
          <RadioGroup
            value={theme.themeMode}
            onChange={theme.setThemeMode}
            className="mt-4"
          >
            <Label className="sr-only">Theme Mode (dark or light)</Label>
            <div className="mt-2 flex flex-wrap gap-6">
              <Radio
                value="system"
                className="w-44 cursor-pointer outline-hidden"
              >
                {({ checked }) => (
                  <>
                    <div
                      className={clsx(
                        "bg-dark-900 relative overflow-hidden rounded-lg border-2 dark:border-transparent",
                        checked &&
                          "ring-primary-600 dark:ring-primary-500 ring-2 ring-offset-2 ring-offset-[var(--color-background)] transition-all",
                      )}
                    >
                      <div
                        style={{
                          clipPath: "polygon(50% 50%, 100% 0, 0 0, 0% 100%)",
                        }}
                        className="w-full space-y-2 bg-gray-50 p-1.5"
                      >
                        <div className="w-full space-y-2 rounded-sm bg-white p-2 shadow-xs">
                          <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                          <div className="bg-gray-150 h-2 w-11/12 rounded-lg"></div>
                        </div>
                        <div className="flex items-center space-x-2 rounded-sm bg-white p-2 shadow-xs">
                          <div className="bg-gray-150 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-gray-150 h-2 w-full rounded-lg"></div>
                        </div>
                        <div className="flex items-center space-x-2 rounded-sm bg-white p-2 shadow-xs">
                          <div className="bg-gray-150 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                        </div>
                      </div>
                      <div
                        style={{
                          clipPath:
                            "polygon(50% 50%, 100% 0, 100% 100%, 0% 100%)",
                        }}
                        className="absolute inset-0 space-y-2 p-1.5"
                      >
                        <div className="bg-dark-700 w-full space-y-2 rounded-sm p-2 shadow-xs">
                          <div className="bg-dark-400 h-2 w-9/12 rounded-lg"></div>
                          <div className="bg-dark-400 h-2 w-11/12 rounded-lg"></div>
                        </div>
                        <div className="bg-dark-700 flex items-center space-x-2 rounded-sm p-2 shadow-xs">
                          <div className="bg-dark-400 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-dark-400 h-2 w-full rounded-lg"></div>
                        </div>
                        <div className="bg-dark-700 flex items-center space-x-2 rounded-sm p-2 shadow-xs">
                          <div className="bg-dark-400 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-dark-400 h-2 w-9/12 rounded-lg"></div>
                        </div>
                      </div>
                    </div>

                    <p className="mt-1.5 text-center">System</p>
                  </>
                )}
              </Radio>
              <Radio
                value="light"
                className="w-44 cursor-pointer outline-hidden"
              >
                {({ checked }) => (
                  <>
                    <div
                      className={clsx(
                        "relative overflow-hidden rounded-lg border-2 dark:border-transparent",
                        checked &&
                          "ring-primary-600 dark:ring-primary-500 ring-2 ring-offset-2 ring-offset-[var(--color-background)] transition-all",
                      )}
                    >
                      <div className="w-full space-y-2 bg-gray-50 p-1.5">
                        <div className="w-full space-y-2 rounded-sm bg-white p-2 shadow-xs">
                          <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                          <div className="bg-gray-150 h-2 w-11/12 rounded-lg"></div>
                        </div>
                        <div className="flex items-center space-x-2 rounded-sm bg-white p-2 shadow-xs">
                          <div className="bg-gray-150 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-gray-150 h-2 w-full rounded-lg"></div>
                        </div>
                        <div className="flex items-center space-x-2 rounded-sm bg-white p-2 shadow-xs">
                          <div className="bg-gray-150 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                        </div>
                      </div>
                    </div>
                    <p className="mt-1.5 text-center">Light</p>
                  </>
                )}
              </Radio>
              <Radio
                value="dark"
                className="w-44 cursor-pointer outline-hidden"
              >
                {({ checked }) => (
                  <>
                    <div
                      className={clsx(
                        "bg-dark-900 relative overflow-hidden rounded-lg border border-transparent",
                        checked &&
                          "ring-primary-600 dark:ring-primary-500 ring-2 ring-offset-2 ring-offset-[var(--color-background)] transition-all",
                      )}
                    >
                      <div className="bg-dark-900 w-full space-y-2 p-1.5">
                        <div className="bg-dark-700 w-full space-y-2 rounded-sm p-2 shadow-xs">
                          <div className="bg-dark-400 h-2 w-9/12 rounded-lg"></div>
                          <div className="bg-dark-400 h-2 w-11/12 rounded-lg"></div>
                        </div>
                        <div className="bg-dark-700 flex items-center space-x-2 rounded-sm p-2 shadow-xs">
                          <div className="bg-dark-400 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-dark-400 h-2 w-full rounded-lg"></div>
                        </div>
                        <div className="bg-dark-700 flex items-center space-x-2 rounded-sm p-2 shadow-xs">
                          <div className="bg-dark-400 size-4 shrink-0 rounded-full"></div>
                          <div className="bg-dark-400 h-2 w-9/12 rounded-lg"></div>
                        </div>
                      </div>
                    </div>
                    <p className="mt-1.5 text-center">Dark</p>
                  </>
                )}
              </Radio>
            </div>
          </RadioGroup>
        </div>
        <div>
          <div>
            <p className="text-base font-medium text-[var(--gray-12)]">
              Primary Color
            </p>
            <p className="mt-0.5">
              Choose a color that will be used as the primary color for your
              theme.
            </p>
          </div>
          <RadioGroup
            value={theme.primaryColorScheme.name}
            onChange={theme.setPrimaryColorScheme}
            className="mt-2"
          >
            <Label className="sr-only">Choose Primary Theme Color</Label>
            <div className="mt-2 flex w-fit flex-wrap gap-4 sm:gap-5">
              {primaryColors.map((color) => (
                <Radio
                  key={color}
                  value={color}
                  className={({ checked }) =>
                    clsx(
                      "flex h-14 w-16 cursor-pointer items-center justify-center rounded-lg border outline-hidden",
                      checked
                        ? "border-primary-500"
                        : "border-[var(--gray-a5)]",
                    )
                  }
                >
                  {({ checked }) => (
                    <div
                      className={clsx(
                        "mask is-diamond size-6 transition-all",
                        checked && "scale-110 rotate-45",
                      )}
                      style={{
                        backgroundColor: colors[color][500],
                      }}
                    ></div>
                  )}
                </Radio>
              ))}
            </div>
          </RadioGroup>
        </div>
        <div>
          <div>
            <p className="text-base font-medium text-[var(--gray-12)]">
              Light Color Scheme
            </p>
            <p className="mt-0.5">
              Select light color scheme that will be used for your theme.
            </p>
          </div>
          <RadioGroup
            value={theme.lightColorScheme.name}
            onChange={theme.setLightColorScheme}
            className="mt-4"
          >
            <Label className="sr-only">Theme Light Mode Color Scheme</Label>
            <div className="mt-2 flex flex-wrap gap-4">
              {lightColors.map((color) => (
                <Radio
                  key={color}
                  value={color}
                  className="w-32 cursor-pointer outline-hidden"
                >
                  {({ checked }) => (
                    <>
                      <div
                        className={clsx(
                          "relative overflow-hidden rounded-lg border-2 dark:border-transparent",
                          checked &&
                            "ring-primary-600 dark:ring-primary-500 ring-2 ring-offset-2 ring-offset-[var(--color-background)] transition-all",
                        )}
                      >
                        <div
                          className="w-full space-y-2 p-1.5"
                          style={{ backgroundColor: colors[color][200] }}
                        >
                          <div className="w-full space-y-2 rounded-sm bg-white p-2 shadow-xs">
                            <div
                              className="h-2 w-9/12 rounded-lg"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                            <div
                              className="h-2 w-11/12 rounded-lg"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                          </div>
                          <div className="flex items-center space-x-2 rounded-sm bg-white p-2 shadow-xs">
                            <div
                              className="size-4 shrink-0 rounded-full"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                            <div
                              className="h-2 w-full rounded-lg"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                          </div>
                        </div>
                      </div>
                      <p className="mt-1.5 text-center capitalize">{color}</p>
                    </>
                  )}
                </Radio>
              ))}
            </div>
          </RadioGroup>
        </div>
        <div>
          <div>
            <p className="text-base font-medium text-[var(--gray-12)]">
              Dark Color Scheme
            </p>
            <p className="mt-0.5">
              Select dark color scheme that will be used for your theme.
            </p>
          </div>
          <RadioGroup
            value={theme.darkColorScheme.name}
            onChange={theme.setDarkColorScheme}
            className="mt-4"
          >
            <Label className="sr-only">Dark Mode Color Schemes</Label>
            <div className="mt-2 flex flex-wrap gap-4">
              {darkColors.map((color) => (
                <Radio
                  key={color}
                  value={color}
                  className="w-32 cursor-pointer outline-hidden"
                >
                  {({ checked }) => (
                    <>
                      <div
                        className={clsx(
                          "relative overflow-hidden rounded-lg",
                          checked &&
                            "ring-primary-600 dark:ring-primary-500 ring-2 ring-offset-2 ring-offset-[var(--color-background)] transition-all",
                        )}
                      >
                        <div
                          className="w-full space-y-2 p-1.5"
                          style={{ backgroundColor: colors[color][900] }}
                        >
                          <div
                            className="w-full space-y-2 rounded-sm p-2 shadow-xs"
                            style={{ backgroundColor: colors[color][700] }}
                          >
                            <div
                              className="h-2 w-9/12 rounded-lg"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                            <div
                              className="h-2 w-11/12 rounded-lg"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                          </div>
                          <div
                            className="flex items-center space-x-2 rounded-sm p-2 shadow-xs"
                            style={{ backgroundColor: colors[color][700] }}
                          >
                            <div
                              className="size-4 shrink-0 rounded-full"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                            <div
                              className="h-2 w-full rounded-lg"
                              style={{ backgroundColor: colors[color][400] }}
                            ></div>
                          </div>
                        </div>
                      </div>
                      <p className="mt-1.5 text-center capitalize">{color}</p>
                    </>
                  )}
                </Radio>
              ))}
            </div>
          </RadioGroup>
        </div>
      </div>
      <div className="my-6 h-px bg-[var(--gray-a4)]"></div>
      <div>
        <div>
          <p className="text-base font-medium text-[var(--gray-12)]">
            Notification
          </p>
          <p className="mt-0.5">
            Choose Notification position and group style for your application
          </p>
        </div>
        <div className="mt-3">
          <p>Notification Group Style</p>
          <RadioGroup
            value={theme.notification?.isExpanded ? "expand" : "stack"}
            onChange={(val) => theme.setNotificationExpand(val === "expand")}
            className="mt-3 text-center"
          >
            <Label className="sr-only">Notification Group Style</Label>
            <div className="grid max-w-xl gap-4 sm:grid-cols-2">
              <Radio value="stack" className="cursor-pointer outline-hidden">
                {({ checked }) => (
                  <>
                    <div
                      className={clsx(
                        "relative flex h-52 w-full items-center rounded-lg border border-[var(--gray-a5)] px-3 py-4",
                        checked &&
                          "ring-primary-600 dark:ring-primary-500 ring-2 ring-offset-2 ring-offset-[var(--color-background)] transition-all",
                      )}
                    >
                      <div className="w-full -space-y-6">
                        <div
                          className="relative flex h-12 w-full flex-col justify-center space-y-2 rounded-sm border bg-white p-2 shadow-[0_4px_12px_#0000001a] dark:shadow-none"
                          style={{ transform: "scale(.9)" }}
                        >
                          <div className="bg-gray-150 h-2 w-11/12 rounded-lg"></div>
                          <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                        </div>
                        <div
                          className="relative flex h-12 w-full flex-col justify-center space-y-2 rounded-sm border bg-white p-2 shadow-[0_4px_12px_#0000001a] dark:shadow-none"
                          style={{ transform: "scale(.95)" }}
                        >
                          <div className="bg-gray-150 h-2 w-11/12 rounded-lg"></div>
                          <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                        </div>
                        <div className="relative flex h-12 w-full flex-col justify-center space-y-2 rounded-sm border bg-white p-2 shadow-[0_4px_12px_#0000001a] dark:shadow-none">
                          <div className="bg-gray-150 h-2 w-11/12 rounded-lg"></div>
                          <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                        </div>
                      </div>
                    </div>
                    <p className="mt-2">Stacked</p>
                  </>
                )}
              </Radio>
              <Radio value="expand" className="cursor-pointer outline-hidden">
                {({ checked }) => (
                  <>
                    <div
                      className={clsx(
                        "relative flex h-52 w-full flex-col justify-between space-y-2 rounded-lg border border-[var(--gray-a5)] px-4 py-5",
                        checked &&
                          "ring-primary-600 dark:ring-primary-500 ring-2 ring-offset-2 ring-offset-[var(--color-background)] transition-all",
                      )}
                    >
                      {Array(3)
                        .fill(null)
                        .map((_, i) => (
                          <div
                            key={i}
                            className="relative flex h-12 w-full flex-col justify-center space-y-2 rounded-sm border bg-white p-2 shadow-[0_4px_12px_#0000001a] dark:shadow-none"
                          >
                            <div className="bg-gray-150 h-2 w-9/12 rounded-lg"></div>
                            <div className="bg-gray-150 h-2 w-11/12 rounded-lg"></div>
                          </div>
                        ))}
                    </div>
                    <p className="mt-2">Expanded</p>
                  </>
                )}
              </Radio>
            </div>
          </RadioGroup>
        </div>
        <div className="mt-4">
          <p>Notification Max Count</p>
          <RadioGroup
            value={theme.notification?.visibleToasts}
            onChange={(val) => theme.setNotificationMaxCount(val)}
            className="mt-3 text-center"
          >
            <Label className="sr-only">Notification Max Count</Label>
            <div className="flex w-full max-w-sm space-x-0.5">
              {Array(MAX_NOTIFICATION_COUNT)
                .fill(null)
                .map((_, i) => (
                  <Radio
                    value={i + 1}
                    key={i}
                    className={({ checked }) =>
                      clsx(
                        "flex-1 cursor-pointer border-2 border-transparent border-b-current pb-1 text-base font-medium outline-hidden",
                        checked
                          ? "text-primary-600 dark:text-primary-400"
                          : "text-[var(--gray-11)]",
                      )
                    }
                  >
                    {i + 1}
                  </Radio>
                ))}
            </div>
          </RadioGroup>
        </div>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3">
          <p className="my-auto">Notification Position:</p>
          <Listbox
            classNames={{
              root: "mt-1.5 flex-1 md:col-span-2 md:mt-0",
            }}
            data={notificationPos}
            value={notificationPos.find(
              (pos) => pos.value === theme.notification?.position,
            )}
            onChange={({ value }) => theme.setNotificationPosition(value)}
          />
        </div>
      </div>
      <div className="my-6 h-px bg-[var(--gray-a4)]"></div>
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3">
          <p className="my-auto">Card Skin:</p>
          <Listbox
            classNames={{
              root: "mt-1.5 flex-1 md:col-span-2 md:mt-0",
            }}
            data={cardSkins}
            value={cardSkins.find((skin) => skin.value === theme.cardSkin)}
            onChange={({ value }) => theme.setCardSkin(value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3">
          <p className="my-auto">Theme Chrome Mode:</p>
          <div className="mt-1.5 flex flex-1 items-center justify-between space-x-2 rounded-lg border border-[var(--gray-a5)] px-3 py-2 md:col-span-2 md:mt-0">
            <p className="text-[var(--gray-12)]">Monochrome Mode</p>
            <Switch
              checked={theme.isMonochrome}
              onChange={(e) => theme.setMonochromeMode(e.target.checked)}
            />
          </div>
        </div>
      </div>
      <div className="mt-10">
        <Button color="cyan" onClick={theme.resetTheme}>
          Reset Theme
        </Button>
      </div>
    </div>
  );
}
