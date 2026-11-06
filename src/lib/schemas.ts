/**
 * Zod schemas for request bodies. Every message is a translation key the
 * frontend shows; the first issue's message becomes `ErrorResponse.code`.
 */
import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 6;

export const email = z
  .email({ error: "errors.email" })
  .max(254, { error: "errors.email" })
  .transform((value) => value.toLowerCase());

export const password = z
  .string({ error: "errors.password" })
  .min(MIN_PASSWORD_LENGTH, { error: "errors.password" })
  .max(200, { error: "errors.password" });

export const name = z
  .string({ error: "errors.name" })
  .trim()
  .min(1, { error: "errors.name" })
  .max(100, { error: "errors.name" });

/** A day as `YYYY-MM-DD`. */
export const date = (error = "errors.date"): z.ZodISODate =>
  z.iso.date({ error });

export const groupId = z.uuid({ error: "errors.group" });

/** Whom the admin adds or moves a record to; ignored for everyone else. */
export const recordUserId = z
  .uuid({ error: "errors.user" })
  .nullish()
  .transform((value) => value ?? undefined);

/** Positive whole cents that fit the database's `integer`. */
export const amountCents = z
  .number({ error: "errors.amount" })
  .int({ error: "errors.amount" })
  .positive({ error: "errors.amount" })
  .max(2_147_483_647, { error: "errors.amount" });

/** Positive, finite and within what `numeric(38, 18)` stores. */
export const positiveDecimal = (error: string): z.ZodNumber =>
  z.number({ error }).positive({ error }).max(1e19, { error });
