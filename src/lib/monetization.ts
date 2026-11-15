export const rimblyProPlans = [
  { id: "weekly", name: "Weekly", priceNaira: 500, priceKobo: 50_000, duration: "7 days" },
  { id: "monthly", name: "Monthly", priceNaira: 2_500, priceKobo: 250_000, duration: "1 month" },
  {
    id: "semester",
    name: "Semester",
    priceNaira: 8_000,
    priceKobo: 800_000,
    duration: "4 months",
  },
] as const;

export type RimblyPlanId = (typeof rimblyProPlans)[number]["id"];

export function getRimblyPlan(planId: string) {
  return rimblyProPlans.find((plan) => plan.id === planId);
}
