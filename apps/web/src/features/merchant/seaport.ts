import { Seaport } from "@opensea/seaport-js";
import { BrowserProvider } from "ethers";
import { getAddress } from "viem";
import type { ChainSlug, MerchantListing } from "@chainatlas/shared";
import { createPrivyWalletClient, ensureWalletChain, type ConnectedPrivyWallet } from "@/features/wallet/use-privy-wallet";

type CreateListingOrderInput = {
  wallet: ConnectedPrivyWallet;
  chain: ChainSlug;
  seller: string;
  nftContract: string;
  tokenId: string;
  priceWei: string;
  expiry?: number;
};

type SeaportOrderEnvelope = {
  parameters: Record<string, unknown>;
  signature: string;
};

function createSeaportClient(provider: unknown) {
  const ethersProvider = new BrowserProvider(provider as never);
  return ethersProvider.getSigner().then((signer) => new Seaport(signer));
}

export async function createSeaportListingOrder(input: CreateListingOrderInput) {
  await ensureWalletChain(input.wallet, input.chain);
  const provider = await input.wallet.getEthereumProvider();
  const seaport = await createSeaportClient(provider);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const endTimeSeconds = input.expiry
    ? Math.floor(input.expiry / 1000)
    : nowSeconds + 7 * 24 * 60 * 60;

  const createOrderResult = await (seaport as any).createOrder(
    {
      offer: [
        {
          itemType: 2,
          token: getAddress(input.nftContract),
          identifier: input.tokenId,
        },
      ],
      consideration: [
        {
          amount: input.priceWei,
          recipient: getAddress(input.seller),
        },
      ],
      startTime: nowSeconds.toString(),
      endTime: endTimeSeconds.toString(),
    },
    getAddress(input.seller),
  );
  const order = (await createOrderResult.executeAllActions()) as SeaportOrderEnvelope;
  const orderHash = (seaport as any).getOrderHash?.(order.parameters);
  return {
    order,
    orderHash: typeof orderHash === "string" ? orderHash : undefined,
    expiry: endTimeSeconds * 1000,
  };
}

export async function fulfillChainAtlasListing(params: {
  wallet: ConnectedPrivyWallet;
  buyer: string;
  chain: ChainSlug;
  listing: MerchantListing;
}) {
  await ensureWalletChain(params.wallet, params.chain);
  if (!params.listing.seaportOrder) {
    throw new Error("Listing has no Seaport order payload");
  }
  const provider = await params.wallet.getEthereumProvider();
  const seaport = await createSeaportClient(provider);
  const fulfillment = await (seaport as any).fulfillOrder({
    order: params.listing.seaportOrder,
    accountAddress: getAddress(params.buyer),
  });
  const transaction = await fulfillment.executeAllActions();
  return transaction.hash as `0x${string}`;
}

export async function submitOpenSeaFulfillmentTransaction(params: {
  wallet: ConnectedPrivyWallet;
  chain: ChainSlug;
  to: string;
  data: string;
  value: string;
}) {
  const walletClient = await createPrivyWalletClient(params.wallet, params.chain);
  if (!walletClient.account) {
    throw new Error("Wallet account is unavailable for fulfillment transaction");
  }
  const hash = await (walletClient as any).sendTransaction({
    to: getAddress(params.to),
    value: BigInt(params.value),
    data: params.data as `0x${string}`,
    account: walletClient.account,
  });
  return hash;
}
