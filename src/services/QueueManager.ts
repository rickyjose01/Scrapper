import * as fs from 'fs';
import * as path from 'path';

export interface QueueItem {
  url: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retries: number;
  error?: string;
  metadata?: any;
}

export interface QueueState {
  jobId: string;
  items: Record<string, QueueItem>;
  createdAt: string;
  updatedAt: string;
}

export class QueueManager {
  private jobId: string;
  private items: Record<string, QueueItem> = {};
  private filePath: string;
  private dirPath: string;

  constructor(jobId: string) {
    this.jobId = jobId;
    // Save queues in a 'data' directory in the workspace root
    this.dirPath = path.join(process.cwd(), 'data');
    this.filePath = path.join(this.dirPath, `queue_${jobId}.json`);
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dirPath)) {
      fs.mkdirSync(this.dirPath, { recursive: true });
    }

    this.load();
  }

  /**
   * Load queue state from disk if it exists
   */
  private load(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const state: QueueState = JSON.parse(raw);
        this.items = state.items;
      } catch (err: any) {
        console.error(`[QueueManager] Failed to load queue file ${this.filePath}: ${err.message}`);
      }
    }
  }

  /**
   * Persist current queue state to disk
   */
  public save(): void {
    try {
      const state: QueueState = {
        jobId: this.jobId,
        items: this.items,
        createdAt: new Date().toISOString(), // In a real system, we'd preserve createdAt
        updatedAt: new Date().toISOString()
      };
      
      // Write to a temp file first and rename to ensure atomicity
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err: any) {
      console.error(`[QueueManager] Failed to save queue state: ${err.message}`);
    }
  }

  /**
   * Enqueue a new URL if it hasn't been added yet
   */
  public enqueue(url: string, type: QueueItem['type'], metadata: any = {}): boolean {
    if (this.items[url]) {
      // If already exists, do not overwrite or duplicate
      return false;
    }

    this.items[url] = {
      url,
      type,
      status: 'pending',
      retries: 0,
      metadata
    };
    
    this.save();
    return true;
  }

  /**
   * Retrieve the next pending item, update its status to 'processing', and save
   */
  public getNextPending(): QueueItem | null {
    const nextUrl = Object.keys(this.items).find(
      (url) => this.items[url].status === 'pending'
    );

    if (!nextUrl) {
      return null;
    }

    const item = this.items[nextUrl];
    item.status = 'processing';
    this.save();
    return item;
  }

  /**
   * Mark an item as successfully completed
   */
  public markCompleted(url: string): void {
    const item = this.items[url];
    if (item) {
      item.status = 'completed';
      item.error = undefined;
      this.save();
    }
  }

  /**
   * Mark an item as failed. Retries if maxRetries is not exceeded.
   */
  public markFailed(url: string, error: string, maxRetries: number = 3): void {
    const item = this.items[url];
    if (item) {
      item.retries++;
      item.error = error;
      
      if (item.retries < maxRetries) {
        // Re-queue it by marking status back to pending
        item.status = 'pending';
        console.log(`[QueueManager] Re-queueing URL: ${url} (Retry ${item.retries}/${maxRetries})`);
      } else {
        item.status = 'failed';
        console.error(`[QueueManager] URL failed permanently: ${url}. Error: ${error}`);
      }
      this.save();
    }
  }

  /**
   * Resets any stuck 'processing' items back to 'pending' on startup
   */
  public resetProcessingItems(): void {
    let updated = false;
    for (const url of Object.keys(this.items)) {
      if (this.items[url].status === 'processing') {
        this.items[url].status = 'pending';
        updated = true;
      }
    }
    if (updated) {
      this.save();
    }
  }

  /**
   * Return stats of the current queue
   */
  public getStats() {
    const total = Object.keys(this.items).length;
    let pending = 0;
    let processing = 0;
    let completed = 0;
    let failed = 0;

    for (const url of Object.keys(this.items)) {
      const status = this.items[url].status;
      if (status === 'pending') pending++;
      else if (status === 'processing') processing++;
      else if (status === 'completed') completed++;
      else if (status === 'failed') failed++;
    }

    return {
      jobId: this.jobId,
      total,
      pending,
      processing,
      completed,
      failed
    };
  }

  /**
   * Check if a URL has already been processed or exists in the queue
   */
  public hasUrl(url: string): boolean {
    return !!this.items[url];
  }

  /**
   * Clean up the queue file from disk (optional)
   */
  public cleanup(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }
}
