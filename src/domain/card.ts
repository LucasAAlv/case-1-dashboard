/**
 * Card normalizado, como fica guardado no cache local.
 * Campo ausente ou vazio na API vira `null`.
 */
export interface CardRecord {
  id: string;
  /** UTC, resolução de segundo. Base da marca d'água do sync incremental. */
  updatedAt: string;
  contactName: string | null;
  email: string | null;
  /** Derivada de `email`: junta as variações de nome da mesma empresa. */
  emailDomain: string | null;
  company: string | null;
  /** Derivada de `company`, sem o sufixo societário (LTDA, Holding, Group...). */
  companyBase: string | null;
  city: string | null;
  state: string | null;
  /** Métrica. Vem da API como string e é convertida na entrada. */
  totalValue: number | null;
  /** Data ISO (AAAA-MM-DD), convertida do formato DD/MM/AAAA da API. */
  dueDate: string | null;
  /** AAAA-MM, para agrupar por mês. */
  dueMonth: string | null;
}
