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

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    date: z.date().optional(),
  }),
});

export const collections = { products, docs, blog };
