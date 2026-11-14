import { cancelSubscription as cancelAbacatePay } from "@/lib/abacatepay";

// Cancela uma assinatura na AbacatePay (único provedor ativo). Linhas antigas
// de `subscriptions` com provider 'stripe' (da época em que o internacional
// cobrava em USD) NÃO podem ser canceladas daqui: o cliente do Stripe foi
// removido, então falhamos alto em vez de mandar um id do Stripe para a
// AbacatePay — quem chama decide o que fazer.
export async function cancelProviderSubscription(
  provider: string | null | undefined,
  providerSubscriptionId: string
): Promise<void> {
  if (provider === "stripe") {
    throw new Error(
      "assinatura criada no Stripe: cancele pelo painel do Stripe (integração removida)"
    );
  }
  await cancelAbacatePay(providerSubscriptionId);
}
