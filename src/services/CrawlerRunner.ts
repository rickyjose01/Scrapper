import * as fs from 'fs';
import * as path from 'path';
import { CrawlerCore } from './CrawlerCore';
import { QueueManager, QueueItem } from './QueueManager';
import { IScraperPlugin } from './IScraperPlugin';

export interface RunnerOptions {
  jobId: string;
  plugin: IScraperPlugin;
  options?: any; // Site-specific options passed to plugin
  maxItems?: number; // Limit on items successfully processed
  delayMin?: number;
  delayMax?: number;
  proxyUrl?: string;
}

export class CrawlerRunner {
  private crawler: CrawlerCore;
  private queue: QueueManager;
  private jobId: string;
  private plugin: IScraperPlugin;
  private maxItems: number;
  private itemsCount: number = 0;
  private isRunning: boolean = false;
  private pluginOptions: any;

  constructor(opts: RunnerOptions) {
    this.jobId = opts.jobId;
    this.plugin = opts.plugin;
    this.maxItems = opts.maxItems || Infinity;
    this.pluginOptions = opts.options || {};
    this.queue = new QueueManager(this.jobId);
    this.crawler = new CrawlerCore({
      delayMin: opts.delayMin,
      delayMax: opts.delayMax,
      proxyUrl: opts.proxyUrl
    });

    this.restoreItemsCount();
  }

  /**
   * Scan data directory to see how many items are already scraped
   */
  private restoreItemsCount(): void {
    const jobDir = path.join(process.cwd(), 'data', 'results', this.jobId);
    if (fs.existsSync(jobDir)) {
      try {
        const files = fs.readdirSync(jobDir);
        // Exclude queue or support files, count regular items
        this.itemsCount = files.filter(f => f.endsWith('.json') && !f.startsWith('queue_') && !f.startsWith('reviews_')).length;
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Main crawler execution loop
   */
  public async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      console.log(`[CrawlerRunner] Starting job ${this.jobId} with plugin ${this.plugin.name} (maxItems=${this.maxItems})`);
      
      this.queue.resetProcessingItems();

      // Seed the queue if empty
      const stats = this.queue.getStats();
      if (stats.total === 0) {
        console.log(`[CrawlerRunner] Seeding empty queue using plugin ${this.plugin.name}...`);
        await this.plugin.onStart(this.queue, this.pluginOptions);
      }

      let activeItem: QueueItem | null = null;

      while (this.isRunning) {
        if (this.itemsCount >= this.maxItems) {
          console.log(`[CrawlerRunner] Reached maximum items limit (${this.maxItems}). Stopping.`);
          break;
        }

        activeItem = this.queue.getNextPending();
        if (!activeItem) {
          console.log(`[CrawlerRunner] No more pending items in queue. Job completed.`);
          break;
        }

        try {
          console.log(`[CrawlerRunner] Processing [${activeItem.type}]: ${activeItem.url}`);
          const html = await this.crawler.fetch(activeItem.url);
          
          // Execute parsing via plugin
          const isItemScraped = await this.plugin.onItem(
            activeItem,
            html,
            this.crawler,
            this.queue
          );

          if (isItemScraped) {
            this.itemsCount++;
          }

          this.queue.markCompleted(activeItem.url);
        } catch (err: any) {
          console.error(`[CrawlerRunner] Failed processing ${activeItem.url}: ${err.message}`);
          this.queue.markFailed(activeItem.url, err.message);
        }
      }
    } finally {
      this.isRunning = false;
      console.log(`[CrawlerRunner] Job ${this.jobId} idle. Stats:`, this.getStatus());
    }
  }

  /**
   * Gracefully stop the execution loop
   */
  public stop(): void {
    this.isRunning = false;
  }

  /**
   * Fetch current job state stats
   */
  public getStatus() {
    return {
      ...this.queue.getStats(),
      itemsCount: this.itemsCount,
      isRunning: this.isRunning,
      pluginName: this.plugin.name
    };
  }
}
