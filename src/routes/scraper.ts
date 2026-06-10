import { type FastifyPluginAsync } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { CrawlerCore } from '../services/CrawlerCore';
import { CrawlerRunner } from '../services/CrawlerRunner';
import { QueueManager } from '../services/QueueManager';
import { IScraperPlugin } from '../services/IScraperPlugin';

// Plugin Registry mapping string identifiers to plugin instantiations
const pluginRegistry: Record<string, () => IScraperPlugin> = {
  
};

// Store active, running jobs in-memory
const activeRunners: Record<string, CrawlerRunner> = {};

interface GenericScrapeBody {
  url: string;
  selectors: Record<string, string>;
}

interface StartScrapeBody {
  plugin: string; // E.g., 'gsmarena'
  jobId?: string;
  options?: any; // Site-specific plugin options
  maxItems?: number;
  delayMin?: number;
  delayMax?: number;
  proxyUrl?: string;
}

const scraperRoutes: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  
  /**
   * Endpoint: POST /api/scrape/generic
   * Fetches raw HTML and runs selector queries dynamically
   */
  fastify.post('/generic', async (request, reply) => {
    const { url, selectors } = request.body as GenericScrapeBody;
    
    if (!url || !selectors || typeof selectors !== 'object') {
      return reply.status(400).send({ error: 'url (string) and selectors (object) are required' });
    }

    try {
      const crawler = new CrawlerCore({ delayMin: 0, delayMax: 0 });
      const html = await crawler.fetch(url);
      const $ = cheerio.load(html);
      
      const result: Record<string, string | string[]> = {};
      
      for (const [key, selector] of Object.entries(selectors)) {
        if (selector.startsWith('[array]')) {
          const cleanSelector = selector.replace('[array]', '').trim();
          const items: string[] = [];
          $(cleanSelector).each((_, el) => {
            items.push($(el).text().trim());
          });
          result[key] = items;
        } else {
          result[key] = $(selector).first().text().trim();
        }
      }

      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: `Scrape failed: ${err.message}` });
    }
  });

  /**
   * Endpoint: POST /api/scrape/start
   * Start a generic background scraper job utilizing a plugin
   */
  fastify.post('/start', async (request, reply) => {
    const body = (request.body || {}) as StartScrapeBody;
    
    if (!body.plugin) {
      return reply.status(400).send({ error: 'plugin parameter is required' });
    }

    const pluginCreator = pluginRegistry[body.plugin.toLowerCase()];
    if (!pluginCreator) {
      return reply.status(400).send({ 
        error: `Plugin '${body.plugin}' not found. Registered plugins: ${Object.keys(pluginRegistry).join(', ')}` 
      });
    }

    const jobId = body.jobId || uuidv4();

    // Check if runner is already active
    if (activeRunners[jobId] && activeRunners[jobId].getStatus().isRunning) {
      return reply.status(400).send({ 
        error: `Job ${jobId} is already running.`,
        jobId
      });
    }

    // Instantiate plugin and runner
    const pluginInstance = pluginCreator();
    const runner = new CrawlerRunner({
      jobId,
      plugin: pluginInstance,
      options: body.options,
      maxItems: body.maxItems,
      delayMin: body.delayMin,
      delayMax: body.delayMax,
      proxyUrl: body.proxyUrl
    });

    activeRunners[jobId] = runner;

    // Dispatch background execution
    runner.run().catch(err => {
      console.error(`[ScraperRoute] Background job ${jobId} failed:`, err);
    });

    return reply.status(202).send({
      message: `Scrape job starting using plugin '${pluginInstance.name}'`,
      jobId,
      statusUrl: `/api/scrape/status/${jobId}`
    });
  });

  /**
   * Endpoint: POST /api/scrape/stop/:jobId
   * Stops a running scraper job
   */
  fastify.post('/stop/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    const runner = activeRunners[jobId];
    if (!runner) {
      return reply.status(404).send({ error: `Job ${jobId} not found in memory` });
    }

    runner.stop();
    return { message: `Stop signal sent to job ${jobId}`, status: runner.getStatus() };
  });

  /**
   * Endpoint: GET /api/scrape/status/:jobId
   * Retrieves execution status and queue progress for a job
   */
  fastify.get('/status/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    const runner = activeRunners[jobId];
    if (runner) {
      return runner.getStatus();
    }

    // Attempt restoring from offline log file if idle
    try {
      const q = new QueueManager(jobId);
      const stats = q.getStats();
      
      let itemsCount = 0;
      const jobDir = path.join(process.cwd(), 'data', 'results', jobId);
      if (fs.existsSync(jobDir)) {
        itemsCount = fs.readdirSync(jobDir).filter(
          f => f.endsWith('.json') && !f.startsWith('queue_') && !f.startsWith('reviews_')
        ).length;
      }

      return {
        ...stats,
        itemsCount,
        isRunning: false,
        message: 'Job is idle (not currently running)'
      };
    } catch (e) {
      return reply.status(404).send({ error: `Job ${jobId} not found` });
    }
  });

  /**
   * Endpoint: GET /api/scrape/results/:jobId
   * Downloads paginated results parsed by the job
   */
  fastify.get('/results/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const query = request.query as { limit?: string; offset?: string };

    const limit = parseInt(query.limit || '100');
    const offset = parseInt(query.offset || '0');

    const jobDir = path.join(process.cwd(), 'data', 'results', jobId);
    if (!fs.existsSync(jobDir)) {
      return reply.status(404).send({ error: `No results directory found for job ${jobId}` });
    }

    try {
      // Filter out files that are reviews-only or queues
      const files = fs.readdirSync(jobDir).filter(
        f => f.endsWith('.json') && !f.startsWith('queue_') && !f.startsWith('reviews_')
      );
      const paginatedFiles = files.slice(offset, offset + limit);

      const items = paginatedFiles.map(file => {
        const filePath = path.join(jobDir, file);
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      });

      return {
        jobId,
        totalResults: files.length,
        limit,
        offset,
        results: items
      };
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to retrieve results: ${err.message}` });
    }
  });
};

export default scraperRoutes;
export const autoPrefix = '/api/scrape';
