// deno-lint-ignore-file no-unused-vars

import {
  BidAndListingEventData,
  BidOpenEventData,
  BidSwapEventData,
  Config,
  MarketplaceEvent,
  SaleEventData,
} from "./src/types.ts";

import {
  bech32,
  blake2b,
  hmac,
  Base64,
  Point,
  Mutex,
  exec,
} from "../deps.ts";

export const config: Config = {
  scriptHash: "6b5d9fa53ca28b537b7f61ef8321f6a2ba620df844ce769d2aafe59d",
  bidPolicyId: "9785fa0349c462aa109f68110fc350cbc9fcbe5c6f6e27ac4aa3d351",
  projects: ["4523c5e21d409b81c95b45b0aea275b8ea1406e6cafea5583b9f8a5f"],
  startPoint: {
    slot: 87848215,
    hash: "8d9022f0d446b7a487aaa07b0f0fc3fd0e5da10650af12175d199a73a02a8ecc",
  },
};

var mutex = new Mutex();
const nftcdnDomain = "poolpm";
const nftcdnKey = Base64.decode(Deno.env.get("NFTCDN_KEY"));

function fingerprint(asset: string): string {
  const digest = blake2b(asset, "hex", undefined, 20) as Uint8Array;
  const words = bech32.toWords(digest);
  return bech32.encode("asset", words);
}

function nftcdnUrl(token: string, uri: string, params: Record<string, any> = {}): string {
  params.tk = nftcdnTk(token, uri, params);
  return buildUrl(nftcdnDomain, token, uri, params);
}

function nftcdnTk(token: string, uri: string, params: Record<string, any> = {}): string | Uint8Array {
  params.tk = "";
  let url = buildUrl(nftcdnDomain, token, uri, params);
  return hmac("sha256", nftcdnKey, url, "utf8", "base64url");
}

function buildUrl(domain: string, token: string, uri: string, params: Record<string, any>): string {
  const searchParams = new URLSearchParams(params);
  return `https://${token}.${domain}.nftcdn.io${uri}?${searchParams.toString()}`;
}

function epoch(): number {
  return Math.floor(((Date.now() / 1000) - 1506203091) / 432000)
}

function slotTimestamp(slot: number): number {
  return 1596491091 + (slot - 4924800);
}

function slotEpoch(slot: number): number {
  return 209 + Math.floor((slot - 4924800) / 432000);
}

async function openFeed(): Promise<[any, any]> {
  const release = await mutex.acquire();
  console.log("Open spacebudz feed");
  let feed = {};
  try {
    feed = JSON.parse(await Deno.readTextFile("feed/spacebudz"));
  } catch {};
  return [feed, release];
}

function keepLastEvents(feed: any): any {
  const maxEvents = 1024;
  let n = 0;
  let newFeed:Record<string, any> = {};
  const epochs = Object.keys(feed).map((e) => parseInt(e)).sort().reverse();
  for (const e of epochs) {
      const epoch = e.toString();
      newFeed[epoch] = {};
      const timestamps = Object.keys(feed[epoch]).map((t) => parseInt(t)).sort().reverse();
      for (const t of timestamps) {
          const ts = t.toString();
          newFeed[epoch][ts] = feed[epoch][ts];
          n += feed[epoch][ts].length;
          if (n > maxEvents) {
            console.log("kept", n, "events");
            return newFeed;
          }
      }
  }
  return newFeed;
}

async function writeFeed(feed: any, release: any) {
  await Deno.writeTextFile(".spacebudz.json", JSON.stringify(keepLastEvents(feed)));
  await Deno.rename(".spacebudz.json", "feed/spacebudz");
  console.log("Updated spacebudz feed");
  await exec("bin/prepare_gz feed/spacebudz");
  release();
}

type MarketplaceEventData = {
  slot: number,
  assets: string[],
  lovelace: number,
  owner?: string,
  buyer?: string,
  seller?: string,
};


async function addFeedEvent(feed: any, action: string, data: MarketplaceEventData): Promise<any> {
  if (data.assets === null) {
    return feed;
  }

  const slot = data.slot;
  const epoch = slotEpoch(slot).toString();
  const ts = slotTimestamp(slot).toString();

  if (!(epoch in feed)) {
    feed[epoch] = {};
  }
  if (!(ts in feed[epoch])) {
    feed[epoch][ts] = [];
  }

  const asset1 = fingerprint(Object.keys(data.assets)[0]);
  const metadataUrl = nftcdnUrl(asset1, "/metadata");
  const resp = await fetch(metadataUrl);
  const metadata = await resp.json();
  const event = {
    type: "market",
    action: action,
    token: metadata.id,
    value: data.lovelace,
    fingerprint: asset1,
    addr: data.owner ? data.owner : (data.buyer && data.buyer.startsWith("addr1") ? data.buyer : data.seller),
    metadata: metadata.metadata,
    tk: nftcdnTk(asset1, "/image", { size: 128 }),
  };

  feed[epoch][ts].push(event);

  return feed;
}

export async function eventsHandler(events: MarketplaceEvent[]) {
  let [feed, release] = await openFeed();
  for (const event of events) {
    switch (event.type) {
      case "BidBundle": {
        const eventData: BidAndListingEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "BidOpen": {
        const eventData: BidOpenEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "BidSingle": {
        const eventData: BidAndListingEventData = event.data;
        feed = await addFeedEvent(feed, "bid", event.data);
        // Your logic here
        break;
      }
      case "ListingBundle": {
        const eventData: BidAndListingEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "ListingSingle": {
        const eventData: BidAndListingEventData = event.data;
        feed = await addFeedEvent(feed, "list", event.data);
        break;
      }
      case "BuyBundle": {
        const eventData: SaleEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "BuySingle": {
        const eventData: SaleEventData = event.data;
        feed = await addFeedEvent(feed, "sold", event.data);
        break;
      }
      case "SellBundle": {
        const eventData: SaleEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "SellSingle": {
        const eventData: SaleEventData = event.data;
        feed = await addFeedEvent(feed, "sold", event.data);
        break;
      }
      case "SellSwap": {
        const eventData: SaleEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "CancelBidBundle": {
        const eventData: BidAndListingEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "CancelBidOpen": {
        const eventData: BidOpenEventData = event.data;
        feed = await addFeedEvent(feed, "unbid", event.data);
        break;
      }
      case "CancelBidSingle": {
        const eventData: BidAndListingEventData = event.data;
        feed = await addFeedEvent(feed, "unbid", event.data);
        break;
      }
      case "CancelListingBundle": {
        const eventData: BidAndListingEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
      case "CancelListingSingle": {
        const eventData: BidAndListingEventData = event.data;
        feed = await addFeedEvent(feed, "unlist", event.data);
        break;
      }
      case "CancelBidSwap": {
        const eventData: BidSwapEventData = event.data;
        console.log("warning: unhandled", event.type);
        break;
      }
    }
  }
  await writeFeed(feed, release);
}

export function onChange() {
}

export async function onRollback(point: Point) {
  let [feed, release] = await openFeed();
  console.log("Rollback to", point);

  const tip = slotTimestamp(point.slot);
  const [minEpoch, maxEpoch] = [slotEpoch(point.slot), epoch()];
  let toRemove = [];
  let epochs = [];
  for (let e = minEpoch; e <= maxEpoch; e++) {
    const epoch = e.toString();
    if (epoch in feed) {
      for (const ts in feed[epoch]) {
        if (parseInt(ts) >= tip) {
          toRemove.push([epoch, ts]);
          epochs.push(epoch);
        }
      }
    }
  }

  // Remove events
  toRemove.forEach(([epoch, ts]) => {
    console.log("remove", epoch, ts);
    delete feed[epoch][ts];
  });

  // Remove empty epochs
  epochs.forEach((epoch) => {
    if (Object.keys(feed[epoch]).length === 0) {
      delete feed[epoch];
      console.log("remove empty epoch", epoch);
    }
  });
  await writeFeed(feed, release);
}
