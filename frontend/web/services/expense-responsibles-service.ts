import { apiClient } from "./api-client";
import type { ExpenseResponsible, ExpenseResponsibleInput, ExpenseStage } from "@/libs/expense-responsibles";

export const fetchExpenseResponsibles = () => apiClient.get<ExpenseResponsible[]>("/expense-responsibles");

export const createExpenseResponsible = (body: ExpenseResponsibleInput) =>
  apiClient.post<ExpenseResponsible>("/expense-responsibles", body);

export const updateExpenseResponsible = (id: string, body: ExpenseResponsibleInput) =>
  apiClient.put<ExpenseResponsible>(`/expense-responsibles/${encodeURIComponent(id)}`, body);

export const deleteExpenseResponsible = (id: string) =>
  apiClient.delete<void>(`/expense-responsibles/${encodeURIComponent(id)}`);

export const importExpenseResponsibles = (rows: ExpenseResponsibleInput[], replace: boolean) =>
  apiClient.post<unknown>("/expense-responsibles/import", { rows, replace });

export interface ResolveQuery {
  stage: ExpenseStage;
  area: string;
  expenseType?: string;
  concept?: string;
  amount?: number;
}

export const resolveExpenseResponsible = (q: ResolveQuery) => {
  const p = new URLSearchParams({ stage: q.stage, area: q.area });
  if (q.expenseType) p.set("expenseType", q.expenseType);
  if (q.concept) p.set("concept", q.concept);
  if (q.amount !== undefined) p.set("amount", String(q.amount));
  return apiClient.get<{ match: { signerId: string; name: string; email: string } | null }>(
    `/expense-responsibles/resolve?${p.toString()}`,
  );
};
