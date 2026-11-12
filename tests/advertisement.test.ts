import {
  api,
  auth,
  createAdmin,
  createCustomer,
  futureDate,
} from './helpers';
import { Advertisement } from '../src/models/Advertisement';
import { AdView } from '../src/models/AdView';

async function createAd(adminToken: string, overrides: Record<string, unknown> = {}) {
  const res = await api()
    .post('/admin/ads')
    .set(...auth(adminToken))
    .send({
      image: 'ads/test.webp',
      destinationUrl: '/stylists',
      ctaText: 'مشاهده متخصص‌ها',
      audience: 'all',
      isActive: true,
      displayIntervalMinutes: 60,
      maxImpressionsPerUser: 0,
      maxImpressionsTotal: 0,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data.advertisement;
}

describe('Advertisements', () => {
  it('supports admin CRUD, image upload, status toggling and delete', async () => {
    const admin = await createAdmin();

    const upload = await api()
      .post('/admin/ads/image')
      .set(...auth(admin.token))
      .attach('image', Buffer.from('fake-image-bytes'), {
        filename: 'promo.png',
        contentType: 'image/png',
      });
    expect(upload.status).toBe(201);
    expect(upload.body.data.key).toBeTruthy();
    expect(upload.body.data.url).toBeTruthy();

    const created = await createAd(admin.token, {
      title: 'کمپین پاییزه',
      description: 'تخفیف ویژه رزرو',
      image: upload.body.data.key,
      audience: 'customers',
      startDate: futureDate(0),
      endDate: futureDate(10),
      displayIntervalMinutes: 120,
    });
    expect(created.title).toBe('کمپین پاییزه');
    expect(created.audience).toBe('customers');
    expect(created.status).toBe('active');
    expect(created.imageUrl).toContain(upload.body.data.key);

    const list = await api().get('/admin/ads').set(...auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.summary.total).toBe(1);

    const updated = await api()
      .patch(`/admin/ads/${created.id}`)
      .set(...auth(admin.token))
      .send({ title: 'کمپین زمستانه' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.advertisement.title).toBe('کمپین زمستانه');

    const disabled = await api()
      .patch(`/admin/ads/${created.id}/status`)
      .set(...auth(admin.token))
      .send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.advertisement.isActive).toBe(false);
    expect(disabled.body.data.advertisement.status).toBe('inactive');

    const removed = await api()
      .delete(`/admin/ads/${created.id}`)
      .set(...auth(admin.token));
    expect(removed.status).toBe(200);
    expect(await Advertisement.countDocuments()).toBe(0);

    const audit = await api()
      .get('/admin/audit-logs')
      .set(...auth(admin.token));
    expect(audit.status).toBe(200);
    expect(
      audit.body.data.items.some(
        (row: { action: string }) => row.action === 'advertisement.create',
      ),
    ).toBe(true);
  });

  it('serves one ad per interval and records impressions/clicks', async () => {
    const admin = await createAdmin();
    const ad = await createAd(admin.token, { displayIntervalMinutes: 60 });

    const first = await api().get('/ads/next?viewer=guest_test_device_1');
    expect(first.status).toBe(200);
    expect(first.body.data.ad.id).toBe(ad.id);

    const claim = await api()
      .post(`/ads/${ad.id}/impression`)
      .send({ viewerKey: 'guest_test_device_1' });
    expect(claim.status).toBe(200);
    expect(claim.body.data.shown).toBe(true);

    // Same campaign is suppressed for this viewer until the interval elapses.
    const second = await api().get('/ads/next?viewer=guest_test_device_1');
    expect(second.body.data.ad).toBeNull();

    // A different guest still sees it.
    const otherGuest = await api().get('/ads/next?viewer=guest_test_device_2');
    expect(otherGuest.body.data.ad.id).toBe(ad.id);

    await api()
      .post(`/ads/${ad.id}/click`)
      .send({ viewerKey: 'guest_test_device_1' });

    const stored = await Advertisement.findById(ad.id);
    expect(stored?.impressions).toBe(1);
    expect(stored?.clicks).toBe(1);

    // Move the last display into the past → eligible again.
    await AdView.updateOne(
      { advertisement: ad.id, viewerKey: 'guest:guest_test_device_1' },
      { $set: { lastShownAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    );
    const again = await api().get('/ads/next?viewer=guest_test_device_1');
    expect(again.body.data.ad.id).toBe(ad.id);
  });

  it('respects per-user and campaign-wide impression caps', async () => {
    const admin = await createAdmin();
    const ad = await createAd(admin.token, {
      displayIntervalMinutes: 1,
      maxImpressionsPerUser: 1,
      maxImpressionsTotal: 1,
    });

    const claim = await api()
      .post(`/ads/${ad.id}/impression`)
      .send({ viewerKey: 'guest_cap_device_1' });
    expect(claim.body.data.shown).toBe(true);

    await AdView.updateOne(
      { advertisement: ad.id, viewerKey: 'guest:guest_cap_device_1' },
      { $set: { lastShownAt: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    // Per-user cap reached.
    const sameViewer = await api().get('/ads/next?viewer=guest_cap_device_1');
    expect(sameViewer.body.data.ad).toBeNull();

    // Campaign-wide cap reached → nobody else sees it either.
    const otherViewer = await api().get('/ads/next?viewer=guest_cap_device_2');
    expect(otherViewer.body.data.ad).toBeNull();

    const rejected = await api()
      .post(`/ads/${ad.id}/impression`)
      .send({ viewerKey: 'guest_cap_device_2' });
    expect(rejected.body.data.shown).toBe(false);
  });

  it('applies audience targeting and schedule/inactive rules', async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();
    const customerOnly = await createAd(admin.token, { audience: 'customers' });

    const guest = await api().get('/ads/next?viewer=guest_audience_1');
    expect(guest.body.data.ad).toBeNull();

    const asCustomer = await api()
      .get('/ads/next?viewer=guest_audience_1')
      .set(...auth(customer.token));
    expect(asCustomer.body.data.ad.id).toBe(customerOnly.id);

    await api()
      .patch(`/admin/ads/${customerOnly.id}/status`)
      .set(...auth(admin.token))
      .send({ isActive: false });
    const inactive = await api()
      .get('/ads/next?viewer=guest_audience_1')
      .set(...auth(customer.token));
    expect(inactive.body.data.ad).toBeNull();

    const scheduled = await createAd(admin.token, {
      audience: 'all',
      startDate: futureDate(2),
    });
    expect(scheduled.status).toBe('scheduled');
    const beforeStart = await api().get('/ads/next?viewer=guest_audience_1');
    expect(beforeStart.body.data.ad).toBeNull();

    const ended = await createAd(admin.token, {
      audience: 'all',
      endDate: futureDate(-2),
    });
    expect(ended.status).toBe('ended');
    const afterEnd = await api().get('/ads/next?viewer=guest_audience_1');
    expect(afterEnd.body.data.ad).toBeNull();
  });
});
