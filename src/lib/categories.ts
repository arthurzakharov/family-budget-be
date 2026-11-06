import type { Category, CategoryKind } from "@/types/responses";

/** Categories every workspace starts with. Their names are translations (`category.<id>`). */
export const BUILT_IN_CATEGORIES: { id: string; kind: CategoryKind }[] = [
  { id: "groceries", kind: "expense" },
  { id: "housing", kind: "expense" },
  { id: "utilities", kind: "expense" },
  { id: "transport", kind: "expense" },
  { id: "health", kind: "expense" },
  { id: "insurance", kind: "expense" },
  { id: "education", kind: "expense" },
  { id: "kids", kind: "expense" },
  { id: "clothing", kind: "expense" },
  { id: "restaurants", kind: "expense" },
  { id: "entertainment", kind: "expense" },
  { id: "travel", kind: "expense" },
  { id: "subscriptions", kind: "expense" },
  { id: "giftsGiven", kind: "expense" },
  { id: "otherExpense", kind: "expense" },
  { id: "salary", kind: "income" },
  { id: "bonus", kind: "income" },
  { id: "freelance", kind: "income" },
  { id: "investments", kind: "income" },
  { id: "rentalIncome", kind: "income" },
  { id: "benefits", kind: "income" },
  { id: "giftsReceived", kind: "income" },
  { id: "refunds", kind: "income" },
  { id: "otherIncome", kind: "income" },
];

type AllCategoriesParams = {
  /** Categories the admin created. */
  custom: { id: string; kind: CategoryKind; name: string }[];
  /** Ids of hidden categories. */
  hidden: string[];
};

/** Built-in and custom categories, each with its hidden flag. */
export function allCategories({
  custom,
  hidden,
}: AllCategoriesParams): Category[] {
  return [
    ...BUILT_IN_CATEGORIES.map((c) => ({ ...c, name: null })),
    ...custom.map(({ id, kind, name }) => ({ id, kind, name })),
  ].map((c) => ({ ...c, hidden: hidden.includes(c.id) }));
}
