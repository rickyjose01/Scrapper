import { CrawlerCore } from './CrawlerCore';
import { QueueManager, QueueItem } from './QueueManager';

export interface IScraperPlugin {
  name: string;
  
  /**
   * Invoked when a job starts for the first time.
   * Allows the plugin to seed the queue with starting URLs.
   */
  onStart(queue: QueueManager, options: any): Promise<void>;

  /**
   * Invoked when the crawler fetches HTML for an item in the queue.
   * Handles parsing and enqueuing child links.
   * Returns a promise resolving to boolean:
   * - true: if a final product/item (e.g. device detail specs) was parsed and saved.
   * - false: if it was a transit page (e.g. catalog list, brand directory).
   */
  onItem(
    item: QueueItem,
    html: string,
    crawler: CrawlerCore,
    queue: QueueManager
  ): Promise<boolean>;
}
