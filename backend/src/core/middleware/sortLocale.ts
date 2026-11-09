import type { NextFunction, Request, Response } from 'express';
import { resolveSortLocale, type SortLocale } from '@soba/lib';
import type { CoreRequestContext } from './requestContext';

/** Sets `req.sortLocale`. A non-empty `Accept-Language` wins over the `locale` query param. */
export const sortLocale = (req: Request, res: Response, next: NextFunction): void => {
  const param = typeof req.query.locale === 'string' ? req.query.locale : undefined;
  req.sortLocale = resolveSortLocale(req.get('accept-language')?.trim() || param);
  res.vary('Accept-Language');
  next();
};

/** The request context plus the sort locale. The route must run both middlewares. */
export const withSortLocale = (
  req: Pick<Request, 'coreContext' | 'sortLocale'>,
): CoreRequestContext & { locale: SortLocale } => ({
  ...req.coreContext!,
  locale: req.sortLocale!,
});
