import util from "util";
import { isMainThread } from "worker_threads";

import * as dl from "play-dl";
import ytmapi from "ytmusic-api";
import { Plugin } from "volcano-sdk";

import logger from "../util/Logger.js";
import Util from "../util/Util.js";
import Constants from "../Constants.js";

const ytm = new ytmapi.default();
const usableRegex = /^https?:\/\/(?:\w+)?\.?youtu\.?be(?:.com)?\/(?:watch\?v=)?\w+/;

class YouTubeSource extends Plugin {
	public source = Constants.STRINGS.YOUTUBE;
	public searchShorts = [Constants.STRINGS.YT, "ytm"];

	public async initialize() {
		if (isMainThread) await ytm.initialize();
	}

	public canBeUsed(resource: string, searchShort?: string) {
		if (searchShort && this.searchShorts.includes(searchShort)) return true;
		else return !!resource.match(usableRegex);
	}

	public async infoHandler(resource: string, searchShort?: string) {
		if (searchShort === Constants.STRINGS.YT) {
			const validated = dl.yt_validate(resource);
			if (validated) {
				try {
					const ID = dl.extractID(resource);
					if (validated === Constants.STRINGS.VIDEO) {
						const d = await dl.video_basic_info(ID);
						return { entries: [YouTubeSource.songResultToTrack(d.video_details)] };
					} else {
						const d = await dl.playlist_info(resource, { incomplete: true });
						if (!d) throw new Error(Constants.STRINGS.NO_PLAYLIST);
						await d.fetch();
						const entries = [] as Array<import("play-dl").YouTubeVideo>;
						for (let i = 1; i < d.total_pages + 1; i++) {
							entries.push(...d.page(i));
						}
						return {
							entries: entries.map(YouTubeSource.songResultToTrack),
							plData: {
								name: d.title as string,
								selectedTrack: 1
							}
						};
					}
				} catch {
					return doSearch();
				}
			} else return doSearch();

			// eslint-disable-next-line no-inner-declarations
			async function doSearch() {
				const searchResults = await dl.search(resource, { limit: 10, source: { youtube: Constants.STRINGS.VIDEO } }) as Array<import("play-dl").YouTubeVideo>;
				const found = searchResults.find(v => v.id === resource);
				if (found) return { entries: [YouTubeSource.songResultToTrack(found)] };
				return { entries: searchResults.map(YouTubeSource.songResultToTrack) };
			}
		} else if (searchShort === "ytm") {
			const tracks = await ytm.searchSongs(resource);
			return {
				entries: tracks.map(t => ({
					title: t.name,
					author: t.artists[0]?.name || Constants.STRINGS.UNKNOWN_AUTHOR,
					identifier: t.videoId,
					uri: `https://youtube.com/watch?v=${t.videoId}`,
					length: Math.round(t.duration * 1000),
					isStream: t.duration === 0
				}))
			};
		}

		let url: URL | undefined = undefined;
		if (resource.startsWith(Constants.STRINGS.HTTP)) url = new URL(resource);
		if (url && url.searchParams.get(Constants.STRINGS.LIST) && url.searchParams.get(Constants.STRINGS.LIST)!.startsWith(Constants.STRINGS.FL_UNDERSCORE) || resource.startsWith(Constants.STRINGS.FL_UNDERSCORE)) throw new Error(Constants.STRINGS.FL_CANNOT_BE_FETCHED);

		if (url && url.searchParams.has(Constants.STRINGS.LIST) || resource.startsWith(Constants.STRINGS.PL)) {
			const pl = await dl.playlist_info(resource, { incomplete: true });
			if (!pl) throw new Error(Constants.STRINGS.NO_PLAYLIST);
			await pl.fetch(100 * lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit);
			const entries = [] as Array<import("play-dl").YouTubeVideo>;
			for (let i = 1; i < pl.total_pages + 1; i++) {
				if (i > lavalinkConfig.lavalink.server.youtubePlaylistLoadLimit) continue;
				entries.push(...pl.page(i));
			}
			return {
				entries: entries.map(YouTubeSource.songResultToTrack),
				plData: {
					name: pl.title!,
					selectedTrack: url?.searchParams.get(Constants.STRINGS.INDEX) ? Number(url.searchParams.get(Constants.STRINGS.INDEX)) : 0
				}
			};
		}

		const id = dl.extractID(resource);
		const data = await dl.video_basic_info(id);

		return { entries: [YouTubeSource.songResultToTrack(data.video_details)] };
	}

	public async streamHandler(info: import("@lavalink/encoding").TrackInfo, usingFFMPEG: boolean) {
		if (!usingFFMPEG) {
			const stream = await dl.stream(info.uri!);
			return { stream: stream.stream, type: stream.type };
		} else {
			const i = await dl.video_info(info.uri!);
			const selected = i.format[i.format.length - 1];
			const response = await Util.connect(selected.url!, { headers: Constants.baseHTTPRequestHeaders });

			return { stream: response };
		}
	}

	private static songResultToTrack(i: import("play-dl").YouTubeVideo) {
		const length = Math.round(i.durationInSec * 1000);
		if (!i.id) {
			logger.warn(`Video(?) didn't have ID attached to it:\n${util.inspect(i, false, 3, true)}`);
			throw new Error("YOUTUBE_VIDEO_HAS_NO_ID");
		}
		return {
			identifier: i.id,
			title: i.title || Constants.STRINGS.UNKNOWN_TITLE,
			length,
			author: i.channel?.name || Constants.STRINGS.UNKNOWN_AUTHOR,
			uri: `https://youtube.com/watch?v=${i.id}`,
			isStream: length === 0
		};
	}
}

export default YouTubeSource;
