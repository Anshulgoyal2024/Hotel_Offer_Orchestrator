import express, { type Express } from 'express';
import type { AppLogger } from '../utils/logger';
import type { HotelOffersService } from '../services/hotel-offers.service';
import type { HealthService } from '../services/health.service';
import { createMockSupplierRouters } from '../mock/supplier.routes';
import { createHomeRouter } from './home.routes';
import { createHotelsRouter } from './hotels.routes';
import { createHealthRouter } from './health.routes';
import { errorHandler, notFoundHandler, requestLogger } from './middleware';

export interface AppDeps {
  logger: AppLogger;
  hotelOffers: HotelOffersService;
  health: HealthService;
  mockChaosEnabled: boolean;
}

/** Pure factory (no listening, no globals) so the app is trivially testable with supertest. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(deps.logger));
  app.use(express.json({ limit: '10kb' }));

  app.use('/', createHomeRouter());
  app.use('/health', createHealthRouter(deps.health));
  app.use('/api/hotels', createHotelsRouter(deps.hotelOffers));

  // Mock supplier APIs live inside this service, as required by the assignment.
  const { supplierA, supplierB } = createMockSupplierRouters(deps.mockChaosEnabled);
  app.use('/supplierA', supplierA);
  app.use('/supplierB', supplierB);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
