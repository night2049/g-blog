// feed 渲染适配器: 基于 npm `feed` 把与库无关的模型渲染为三格式. 实现 FeedRenderer 端口.
// 第三方 `feed` 依赖被隔离在此文件, domain 不感知, 可整体替换.
import { Feed } from "feed";
import type { FeedChannel, FeedItem, FeedRenderer } from "../domain/types.ts";

export function createFeedRenderer(): FeedRenderer {
  return {
    render(channel: FeedChannel, items: FeedItem[]) {
      const feed = new Feed({
        title: channel.title,
        description: channel.description,
        id: channel.id,
        link: channel.link,
        language: channel.language,
        copyright: channel.author,
        updated: new Date(channel.updated),
        author: { name: channel.author },
      });
      for (const it of items) {
        feed.addItem({
          title: it.title,
          id: it.id,
          link: it.link,
          date: new Date(it.date),
          description: it.description,
          content: it.content,
        });
      }
      return { rss: feed.rss2(), atom: feed.atom1(), json: feed.json1() };
    },
  };
}
