/**
 * Skema Zod untuk Agentic AI (Understand & Actions).
 * Sesuai prd.md §12.3, §12.5 dan 02-fase2-keuangan-inti.md.
 */

import { z } from 'zod';

export const AddTransactionActionSchema = z.object({
  tool: z.literal('add_transaction'),
  args: z.object({
    type: z.enum(['masuk', 'keluar']),
    amount: z.number().int().positive().max(1_000_000_000),
    category: z.string().nullable().optional(),
    pocket: z.string().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }),
});

export const SetMonthlyIncomeActionSchema = z.object({
  tool: z.literal('set_monthly_income'),
  args: z.object({
    amount: z.number().int().positive().max(1_000_000_000),
    mode: z.enum(['tambah', 'ganti']).optional().default('tambah'),
  }),
});

export const SetAllocationActionSchema = z.object({
  tool: z.literal('set_allocation'),
  args: z.object({
    items: z
      .array(
        z.object({
          pocket: z.string().min(1),
          percent: z.number().min(0).max(100).optional(),
          amount: z.number().int().nonnegative().optional(),
        })
      )
      .min(1),
  }),
});

export const CreatePocketActionSchema = z.object({
  tool: z.literal('create_pocket'),
  args: z.object({
    name: z.string().min(1).max(50),
    rollover_mode: z.enum(['carry', 'return']).optional().default('carry'),
  }),
});

export const RenamePocketActionSchema = z.object({
  tool: z.literal('rename_pocket'),
  args: z.object({
    old_name: z.string().min(1),
    new_name: z.string().min(1).max(50),
  }),
});

export const SetPocketActiveActionSchema = z.object({
  tool: z.literal('set_pocket_active'),
  args: z.object({
    name: z.string().min(1),
    is_active: z.boolean(),
  }),
});

export const SetRolloverModeActionSchema = z.object({
  tool: z.literal('set_rollover_mode'),
  args: z.object({
    pocket: z.string().min(1),
    mode: z.enum(['carry', 'return']),
  }),
});

export const TransferBetweenPocketsActionSchema = z.object({
  tool: z.literal('transfer_between_pockets'),
  args: z.object({
    from: z.string().nullable().optional(), // 'utama' / null = Saldo Utama
    to: z.string().nullable().optional(),   // 'utama' / null = Saldo Utama
    amount: z.number().int().positive().max(1_000_000_000),
    note: z.string().max(200).nullable().optional(),
  }),
});

export const ActionSchema = z.discriminatedUnion('tool', [
  AddTransactionActionSchema,
  SetMonthlyIncomeActionSchema,
  SetAllocationActionSchema,
  CreatePocketActionSchema,
  RenamePocketActionSchema,
  SetPocketActiveActionSchema,
  SetRolloverModeActionSchema,
  TransferBetweenPocketsActionSchema,
]);

export const INTENTS = [
  'catat_transaksi',
  'uang_bulanan',
  'atur_kantong',
  'transfer_kantong',
  'chat_biasa',
  'klarifikasi',
];

export const UnderstandSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  actions: z.array(ActionSchema).max(5),
  clarification: z.string().nullable(),
});
