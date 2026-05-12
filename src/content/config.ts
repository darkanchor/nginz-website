import { defineCollection, z } from "astro:content";

const products = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    license: z.string(),
    category: z.string().optional(),
    tagline: z.string().optional(),
  }),
});

const docs = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
});

export const collections = { products, docs };
