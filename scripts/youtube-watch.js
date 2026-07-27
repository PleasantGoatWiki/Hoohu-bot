import { MediaWikiApi } from 'wiki-saikou';
import config from './utils/config.js';

const api = new MediaWikiApi(config.api, { headers: { 'user-agent': config.useragent } });

const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCbELDDHGqMbjsA_4Kyd7vMw';
const TARGET = {
    json: 'New Wild Cosmos',
    keywords: ['New', 'Wild', 'Cosmos'],
    episodeRegex: /\bEP(\d{2})\b/i
};

async function fetchFeed() {
    const res = await fetch(FEED);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    return await res.text();
}

function parseFeed(xml) {
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let m;

    while ((m = entryRegex.exec(xml)) !== null && entries.length < 2) {
        const body = m[1];
        const title = body.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
        const videoId = body.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1]?.trim() || '';
        entries.push({ title, videoId });
    }

    return entries;
}

async function fetchJson() {
    const { data } = await api.post(
        {
            action: 'query',
            titles: `Template:Episode/${TARGET.json}.json`,
            prop: 'revisions',
            rvprop: 'content'
        },
        { retry: 10 }
    );
    const page = data.query.pages[0];

    return JSON.parse(page.revisions[0].content);
}

async function fetchPage(title) {
    const { data } = await api.post(
        {
            action: 'query',
            titles: title,
            prop: 'revisions',
            rvprop: 'content'
        },
        { retry: 10 }
    );

    return data.query.pages[0];
}

async function savePage(title, text) {
    return api.postWithToken(
        'csrf',
        {
            action: 'edit',
            title,
            text,
            summary: 'Add YouTube link.',
            bot: true,
            tags: 'hoohu-youtube',
            watchlist: 'nochange'
        },
        { retry: 10, noCache: true }
    );
}

function getPageTitle(ep) {
    if (ep.suffix) {
        return `${ep.english} (${ep.suffix})`;
    }

    return ep.english;
}

(async () => {
    console.log(`[${new Date().toISOString()}] YouTube watch updater started.`);
    await api.login(config.bot.name, config.bot.password);

    console.log('Fetching YouTube feed...');
    const xml = await fetchFeed();
    const entries = parseFeed(xml);
    console.log(`Fetched ${entries.length} entries.`);

    const json = await fetchJson();
    for (const item of entries) {
        console.log(`Checking "${item.title}"`);

        const ok = TARGET.keywords.every((k) => item.title.includes(k));
        if (!ok) {
            console.log('  Skip: keywords not matched.');
            continue;
        }

        const match = item.title.match(TARGET.episodeRegex);
        if (!match) {
            console.log('  Skip: episode number not found.');
            continue;
        }

        const epNum = Number(match[1]);
        const ep = json.episodes.find((e) => Number(e.num) === epNum);
        if (!ep) {
            console.log(`  Skip: episode ${epNum} not found in JSON.`);
            continue;
        }

        const pageTitle = getPageTitle(ep);
        console.log(`  Target page: ${pageTitle}`);

        const page = await fetchPage(pageTitle);
        if (page.missing) {
            console.log('  Skip: page does not exist.');
            continue;
        }

        const content = page.revisions[0].content;
        if (/==\s*Watch\s*==/i.test(content)) {
            console.log('  Watch section already exists.');
            continue;
        }

        const navMatch = /==\s*Navigation\s*==/i.exec(content);
        if (!navMatch) {
            console.log('  Skip: Navigation section not found.');
            continue;
        }

        const insert = `==Watch==
{{yt|${item.videoId}}}

`;
        const newContent = content.slice(0, navMatch.index) + insert + content.slice(navMatch.index);
        console.log('  Saving...');

        const { data } = await savePage(pageTitle, newContent);
        console.log(JSON.stringify(data));
    }

    console.log(`[${new Date().toISOString()}] YouTube watch updater completed.`);
})();
