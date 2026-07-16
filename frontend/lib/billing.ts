import { cancelSubscription as cancelAbacatePay } from "@/lib/abacatepay";
import { cancelStripeSubscription } from "@/lib/stripe";

// Cancela uma assinatura no provedor certo (stripe no internacional,
// abacatepay no Brasil), lendo o `provider` da linha de subscriptions. Best
// effort: usado no downgrade/upgrade, onde a assinatura pode já não existir do
// lado do provedor.
export async function cancelProviderSubscription(
  provider: string | null | undefined,
  providerSubscriptionId: string
): Promise<void> {
  if (provider === "stripe") {
    await cancelStripeSubscription(providerSubscriptionId);
  } else {
    await cancelAbacatePay(providerSubscriptionId);
  }
}
