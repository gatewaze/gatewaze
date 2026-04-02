export type NotificationType = "message" | "task" | "log" | "security";

export type MaskType =
  | "circle"
  | "squircle"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "hexagon2"
  | "star"
  | "star2"
  | "octagon";

export type RequiredIf<
  T,
  Condition extends boolean,
  K extends keyof T,
> = Condition extends true ? T & Required<Pick<T, K>> : T;
