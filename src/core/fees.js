// Steam Community Market seller fees, ported from Valve's own client-side
// algorithm (economy_common.js: CalculateFeeAmount and
// CalculateAmountToSendForDesiredReceivedAmount). All amounts are integer
// minor units (cents). The buyer pays `amount`; the seller receives
// `amount - fees`.
// TODO(verify): community ports disagree on a few edge cases; compare a
// handful of prices against Steam's own "You receive" listing preview.

export const DEFAULT_WALLET = Object.freeze({
  walletFeePercent: 0.05, // Steam transaction fee
  walletFeeMinimum: 1,
  walletFeeBase: 0,
});

// Publisher fee for CS2, Dota 2, TF2, Rust and Steam Community items.
export const DEFAULT_PUBLISHER_FEE = 0.1;

export function amountToSendForReceived(received, publisherFee = DEFAULT_PUBLISHER_FEE, wallet = DEFAULT_WALLET) {
  const steamFee = Math.floor(Math.max(received * wallet.walletFeePercent, wallet.walletFeeMinimum) + wallet.walletFeeBase);
  const pubFee = Math.floor(publisherFee > 0 ? Math.max(received * publisherFee, 1) : 0);
  return {
    steamFee,
    publisherFee: pubFee,
    fees: steamFee + pubFee,
    amount: received + steamFee + pubFee,
  };
}

// Given what the buyer pays, find the fee split exactly as Steam does.
export function calculateFees(amount, publisherFee = DEFAULT_PUBLISHER_FEE, wallet = DEFAULT_WALLET) {
  const total = Math.trunc(amount);
  let estimate = Math.trunc((total - wallet.walletFeeBase) / (wallet.walletFeePercent + publisherFee + 1));
  let everUndershot = false;
  let fees = amountToSendForReceived(estimate, publisherFee, wallet);
  let iterations = 0;

  while (fees.amount !== total && iterations < 10) {
    if (fees.amount > total) {
      if (everUndershot) {
        fees = amountToSendForReceived(estimate - 1, publisherFee, wallet);
        const diff = total - fees.amount;
        fees.steamFee += diff;
        fees.fees += diff;
        fees.amount = total;
        break;
      }
      estimate--;
    } else {
      everUndershot = true;
      estimate++;
    }
    fees = amountToSendForReceived(estimate, publisherFee, wallet);
    iterations++;
  }
  return fees;
}

// What the seller receives when a buyer pays `amount`. Never negative.
export function sellerReceives(amount, publisherFee = DEFAULT_PUBLISHER_FEE, wallet = DEFAULT_WALLET) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const { fees } = calculateFees(amount, publisherFee, wallet);
  return Math.max(0, Math.trunc(amount) - fees);
}
