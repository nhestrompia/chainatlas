import { Seaport } from "@opensea/seaport-js";
import { BrowserProvider, Interface } from "ethers";
import { getAddress } from "viem";
import type { ChainSlug, MerchantListing } from "@chainatlas/shared";
import { createPrivyWalletClient, ensureWalletChain, type ConnectedPrivyWallet } from "@/features/wallet/use-privy-wallet";

type CreateListingOrderInput = {
  wallet: ConnectedPrivyWallet;
  chain: ChainSlug;
  seller: string;
  nftContract: string;
  tokenId: string;
  tokenStandard: "erc721" | "erc1155" | "unknown";
  priceWei: string;
  requiredFeeSplits?: Array<{
    recipient: string;
    basisPoints: number;
  }>;
  expiry?: number;
};

type SeaportOrderEnvelope = {
  parameters: Record<string, unknown>;
  signature: string;
};

const BPS_DENOMINATOR = 10_000n;
const OPENSEA_CONDUIT_KEY =
  "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000";
const DEFAULT_OPENSEA_REQUIRED_FEE_SPLITS_BY_CHAIN: Record<
  ChainSlug,
  Array<{ recipient: string; basisPoints: number }>
> = {
  ethereum: [
    {
      recipient: "0x0000a26b00c1F0DF003000390027140000fAa719",
      basisPoints: 100,
    },
  ],
  base: [
    {
      recipient: "0x0000a26b00c1F0DF003000390027140000fAa719",
      basisPoints: 100,
    },
  ],
  polygon: [
    {
      recipient: "0x0000a26b00c1F0DF003000390027140000fAa719",
      basisPoints: 100,
    },
  ],
};

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_, nextValue) =>
      typeof nextValue === "bigint" ? nextValue.toString() : nextValue,
    ),
  ) as T;
}

const erc721OwnerOfInterface = new Interface([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);
const erc1155BalanceOfInterface = new Interface([
  "function balanceOf(address owner, uint256 id) view returns (uint256)",
]);

function createSeaportClient(provider: unknown) {
  const ethersProvider = new BrowserProvider(provider as never);
  return ethersProvider.getSigner().then((signer) => new Seaport(signer));
}

async function assertNftOwnership(params: {
  provider: unknown;
  seller: string;
  nftContract: string;
  tokenId: string;
  tokenStandard: "erc721" | "erc1155" | "unknown";
}) {
  const ethersProvider = new BrowserProvider(params.provider as never);
  const tokenId = BigInt(params.tokenId);
  const seller = getAddress(params.seller);
  const verifyErc721 = async () => {
    const callData = erc721OwnerOfInterface.encodeFunctionData("ownerOf", [tokenId]);
    const callResult = await ethersProvider.call({
      to: getAddress(params.nftContract),
      data: callData,
    });
    const [owner] = erc721OwnerOfInterface.decodeFunctionResult("ownerOf", callResult);
    if (typeof owner !== "string" || owner.toLowerCase() !== seller.toLowerCase()) {
      throw new Error("Selected NFT is not owned by this wallet on the active chain.");
    }
  };

  const verifyErc1155 = async () => {
    const callData = erc1155BalanceOfInterface.encodeFunctionData("balanceOf", [seller, tokenId]);
    const callResult = await ethersProvider.call({
      to: getAddress(params.nftContract),
      data: callData,
    });
    const [balance] = erc1155BalanceOfInterface.decodeFunctionResult("balanceOf", callResult);
    const normalized = typeof balance === "bigint" ? balance : BigInt(balance as string);
    if (normalized <= 0n) {
      throw new Error("Selected NFT is not owned by this wallet on the active chain.");
    }
  };

  if (params.tokenStandard === "erc721") {
    try {
      await verifyErc721();
      return "erc721" as const;
    } catch {
      throw new Error(
        "Selected NFT is not a supported ERC-721 owned by this wallet on the active chain.",
      );
    }
  }
  if (params.tokenStandard === "erc1155") {
    try {
      await verifyErc1155();
      return "erc1155" as const;
    } catch {
      throw new Error(
        "Selected NFT is not a supported ERC-1155 owned by this wallet on the active chain.",
      );
    }
  }

  try {
    await verifyErc721();
    return "erc721" as const;
  } catch {}
  try {
    await verifyErc1155();
    return "erc1155" as const;
  } catch {}
  throw new Error(
    "Selected NFT is not a supported ERC-721/ERC-1155 owned by this wallet on the active chain.",
  );
}

export async function createSeaportListingOrder(input: CreateListingOrderInput) {
  await ensureWalletChain(input.wallet, input.chain);
  const provider = await input.wallet.getEthereumProvider();
  const detectedTokenStandard =
    input.tokenStandard === "erc721" || input.tokenStandard === "erc1155"
      ? input.tokenStandard
      : await assertNftOwnership({
          provider,
          seller: input.seller,
          nftContract: input.nftContract,
          tokenId: input.tokenId,
          tokenStandard: input.tokenStandard,
        });
  const seaport = await createSeaportClient(provider);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const endTimeSeconds = input.expiry
    ? Math.floor(input.expiry / 1000)
    : nowSeconds + 7 * 24 * 60 * 60;
  const grossPriceWei = BigInt(input.priceWei);
  const rawFeeSplits =
    input.requiredFeeSplits && input.requiredFeeSplits.length > 0
      ? input.requiredFeeSplits
      : DEFAULT_OPENSEA_REQUIRED_FEE_SPLITS_BY_CHAIN[input.chain];
  const normalizedFeeSplits = new Map<string, number>();
  for (const split of rawFeeSplits) {
    if (!split || typeof split.basisPoints !== "number" || split.basisPoints <= 0) {
      continue;
    }
    const recipient = getAddress(split.recipient).toLowerCase();
    const basisPoints = Math.round(split.basisPoints);
    if (basisPoints <= 0) {
      continue;
    }
    const nextValue = (normalizedFeeSplits.get(recipient) ?? 0) + basisPoints;
    normalizedFeeSplits.set(recipient, nextValue);
  }
  const totalFeeBps = [...normalizedFeeSplits.values()].reduce(
    (sum, value) => sum + BigInt(value),
    0n,
  );
  if (totalFeeBps >= BPS_DENOMINATOR) {
    throw new Error("Required marketplace/creator fees are too high for this listing price.");
  }
  const feeConsiderations = [...normalizedFeeSplits.entries()]
    .map(([recipient, basisPoints]) => {
      const amount = (grossPriceWei * BigInt(basisPoints)) / BPS_DENOMINATOR;
      return {
        amount,
        recipient,
      };
    })
    .filter((fee) => fee.amount > 0n);
  const totalFeeWei = feeConsiderations.reduce(
    (sum, fee) => sum + fee.amount,
    0n,
  );
  const sellerProceedsWei = grossPriceWei - totalFeeWei;
  if (sellerProceedsWei <= 0n) {
    throw new Error("Listing price is too low after marketplace fee.");
  }

  const offerItem =
    detectedTokenStandard === "erc1155"
      ? {
          itemType: 3,
          token: getAddress(input.nftContract),
          identifier: input.tokenId,
          amount: "1",
        }
      : {
          itemType: 2,
          token: getAddress(input.nftContract),
          identifier: input.tokenId,
        };

  const createOrderResult = await (seaport as any).createOrder(
    {
      offer: [offerItem],
      consideration: [
        {
          amount: sellerProceedsWei.toString(),
          recipient: getAddress(input.seller),
        },
        ...feeConsiderations.map((fee) => ({
          amount: fee.amount.toString(),
          recipient: getAddress(fee.recipient),
        })),
      ],
      conduitKey: OPENSEA_CONDUIT_KEY,
      startTime: nowSeconds.toString(),
      endTime: endTimeSeconds.toString(),
    },
    getAddress(input.seller),
  );
  const rawOrder = (await createOrderResult.executeAllActions()) as SeaportOrderEnvelope;
  const orderHash = (seaport as any).getOrderHash?.(rawOrder.parameters);
  const order = toJsonSafe(rawOrder);
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

export async function cancelSeaportListing(params: {
  wallet: ConnectedPrivyWallet;
  chain: ChainSlug;
  seller: string;
  listing: MerchantListing;
}) {
  await ensureWalletChain(params.wallet, params.chain);
  if (!params.listing.seaportOrder || typeof params.listing.seaportOrder !== "object") {
    throw new Error("Listing is missing order payload required for cancellation.");
  }
  const orderRecord = params.listing.seaportOrder as Record<string, unknown>;
  const orderParameters =
    orderRecord.parameters && typeof orderRecord.parameters === "object"
      ? (orderRecord.parameters as Record<string, unknown>)
      : orderRecord;
  if (!orderParameters || typeof orderParameters !== "object") {
    throw new Error("Listing has invalid order payload for cancellation.");
  }
  const provider = await params.wallet.getEthereumProvider();
  const seaport = await createSeaportClient(provider);
  const cancellation = await (seaport as any).cancelOrders(
    [orderParameters],
    getAddress(params.seller),
  );
  const transaction = await cancellation.transact();
  return transaction.hash as `0x${string}`;
}
