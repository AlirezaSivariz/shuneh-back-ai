import path from "path";
import express, { Application, Request, Response } from "express";
import cors from "cors";
import morgan from "morgan";
// import "./types/express"; // load Request augmentation

import { config } from "./config/env";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { sendSuccess } from "./utils/response";

import authRoutes from "./modules/auth/auth.routes";
import {
  onboardingRouter,
  meRouter,
} from "./modules/onboarding/onboarding.routes";
import serviceRoutes from "./modules/service/service.routes";
import geoRoutes from "./modules/geo/geo.routes";
import stylistRoutes from "./modules/stylist/stylist.routes";
import stylistsPublicRoutes from "./modules/stylist/public.routes";
import mediaRoutes from "./modules/media/media.routes";
import imageRoutes from "./modules/media/image.routes";
import salonRoutes from "./modules/salon/salon.routes";
import { ownerRouter } from "./modules/salon/owner.routes";
import inviteRoutes from "./modules/invite/invite.routes";
import { adminRouter } from "./modules/admin/admin.routes";
import blogRoutes from "./modules/blog/blog.routes";
import socialRoutes from "./modules/social/social.routes";
import {
  internalRouter,
  reservationRouter,
} from "./modules/reservation/reservation.routes";

export function createApp(): Application {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  if (config.isDev) app.use(morgan("dev"));

  // Static serving of uploaded files (local driver).
  app.use("/uploads", express.static(path.resolve(config.uploadDir)));
  // Stable public image URLs (served from whichever store is active).
  app.use("/images", imageRoutes);

  // Health check.
  app.get("/health", (_req: Request, res: Response) => {
    sendSuccess(res, { status: "ok", env: config.nodeEnv });
  });

  // Feature routes.
  app.use("/auth", authRoutes);
  app.use("/onboarding", onboardingRouter);
  app.use("/me", meRouter);
  app.use("/services", serviceRoutes);
  // Static reference data (provinces/cities) for selects + map.
  app.use("/geo", geoRoutes);
  // Mount the more specific /stylist/media before /stylist so it matches first.
  app.use("/stylist/media", mediaRoutes);
  app.use("/stylist", stylistRoutes);
  // Public customer-facing stylist discovery (plural path).
  app.use("/stylists", stylistsPublicRoutes);
  app.use("/salons", salonRoutes);
  // Public SEO blog (published posts).
  app.use("/blog", blogRoutes);
  // Internal social network (feed public; writes gated by plan/auth).
  app.use("/social", socialRoutes);
  app.use("/owner", ownerRouter);
  app.use("/invite", inviteRoutes);
  app.use("/reservations", reservationRouter);
  app.use("/admin", adminRouter);
  app.use("/internal", internalRouter);

  // 404 + central error handler (must be last).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
