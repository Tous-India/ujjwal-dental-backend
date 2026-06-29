import mongoose from 'mongoose';

/**
 * MEMBERSHIP PLAN MODEL
 *
 * Membership plans for Ujjwal Dental Clinic
 *
 * Plans offered:
 * 1. Individual Silver - ₹999/year - 10% discount
 * 2. Individual Gold - ₹1999/year - 15% discount + 1 free cleaning
 * 3. Individual Platinum - ₹2999/year - 20% discount + 2 free cleanings
 * 4. Family Silver - ₹1999/year - 10% discount (up to 4 members)
 * 5. Family Gold - ₹3499/year - 15% discount + 2 free cleanings
 * 6. Family Platinum - ₹4999/year - 20% discount + 4 free cleanings
 *
 * Note: Patient's membership details are embedded in Patient model
 * This model is just for membership plan definitions
 */

// ============ BENEFIT SCHEMA ============

const benefitSchema = new mongoose.Schema(
  {
    // Benefit type
    type: {
      type: String,
      enum: ['discount', 'free_service', 'priority_booking', 'home_visit', 'other'],
      required: true,
    },

    // Description
    description: {
      type: String,
      required: true,
    },

    // For discount type: percentage
    discountPercentage: Number,

    // For free_service type: service name and quantity
    freeService: {
      name: String,
      quantity: Number,
    },

    // Any conditions
    conditions: String,
  },
  { _id: false }
);

// ============ MEMBERSHIP PLAN SCHEMA ============

const membershipPlanSchema = new mongoose.Schema(
  {
    // Plan name
    name: {
      type: String,
      required: [true, 'Plan name is required'],
      unique: true,
    },

    // Plan code for reference
    code: {
      type: String,
      required: [true, 'Plan code is required'],
      unique: true,
      uppercase: true,
    },

    // Plan type
    type: {
      type: String,
      enum: ['individual', 'family'],
      required: [true, 'Plan type is required'],
    },

    // Tier level
    tier: {
      type: String,
      enum: ['silver', 'gold', 'platinum', 'premium', 'star'],
      required: [true, 'Plan tier is required'],
    },

    // Description
    description: String,

    // Terms & conditions (shown in the purchase modal)
    terms: String,

    // Price per year
    price: {
      type: Number,
      required: [true, 'Plan price is required'],
    },

    // Duration in months
    durationMonths: {
      type: Number,
      default: 12, // 1 year
    },

    // Discount percentage on treatments
    discountPercentage: {
      type: Number,
      required: [true, 'Discount percentage is required'],
      min: 0,
      max: 100,
    },

    // For family plans: max members allowed
    maxMembers: {
      type: Number,
      default: 1, // 1 for individual, 4 for family
    },

    // Benefits list
    benefits: [benefitSchema],

    // Features list (simple text)
    features: [String],

    // Is this plan currently available?
    isActive: {
      type: Boolean,
      default: true,
    },

    // Permanently retired — plan is hidden from public and shown with "Discontinued" badge
    // on patient pages. Unlike isActive, discontinued plans are never meant to be reactivated
    // (though admins can still override).
    discontinued: {
      type: Boolean,
      default: false,
    },

    // Display order for UI
    displayOrder: {
      type: Number,
      default: 0,
    },

  },
  {
    timestamps: true,
  }
);

// ============ INDEXES ============

membershipPlanSchema.index({ type: 1, tier: 1 });
membershipPlanSchema.index({ isActive: 1 });

// ============ VIRTUALS ============

/**
 * Get formatted price display
 */
membershipPlanSchema.virtual('priceDisplay').get(function () {
  return `₹${this.price.toLocaleString('en-IN')}/year`;
});

/**
 * Get full plan name
 */
membershipPlanSchema.virtual('fullName').get(function () {
  const typeCapitalized = this.type.charAt(0).toUpperCase() + this.type.slice(1);
  const tierCapitalized = this.tier.charAt(0).toUpperCase() + this.tier.slice(1);
  return `${typeCapitalized} ${tierCapitalized}`;
});

// Enable virtuals in JSON
membershipPlanSchema.set('toJSON', { virtuals: true });
membershipPlanSchema.set('toObject', { virtuals: true });

// ============ STATICS ============

/**
 * Get all active plans grouped by type
 */
membershipPlanSchema.statics.getActivePlans = async function () {
  const plans = await this.find({ isActive: true }).sort({ displayOrder: 1 });

  return {
    individual: plans.filter((p) => p.type === 'individual'),
    family: plans.filter((p) => p.type === 'family'),
  };
};

/**
 * Seed default membership plans
 * Call this once during initial setup
 */
membershipPlanSchema.statics.seedDefaultPlans = async function () {
  const defaultPlans = [
    {
      name: 'Implant Post Care',
      code: 'IMP-PC',
      type: 'individual',
      tier: 'platinum',
      description: 'Comprehensive one-year post-operative dental implant care plan.',
      price: 4500,
      discountPercentage: 30,
      maxMembers: 1,
      features: [
        'OPD for one year',
        'Oral Prophylaxis (twice a year)',
        'Two oral health kits in a year',
        'RVG for one year',
        'Post Operative Dental Implant Care',
      ],
      benefits: [
        { type: 'free_service', description: 'Free consultation and X-ray', freeService: { name: 'Consultation & X-ray', quantity: 1 } },
      ],
      displayOrder: 1,
    },
    {
      name: 'Cosmodentofacial Family Dental Plan',
      code: 'CDF-FAM',
      type: 'family',
      tier: 'gold',
      description: 'Complete family dental care with check-ups, cleaning and discounted cosmetic treatments',
      price: 4999,
      discountPercentage: 20,
      maxMembers: 4,
      features: [
        'Complete family dental check-up and cleaning',
        'Discounted rates on cosmetic and orthodontic treatments',
        '₹500 off per clinic visit',
        '30% off on surgery',
        'Free consultation and X-ray for the entire family',
      ],
      benefits: [
        { type: 'discount', description: '20% off on all treatments', discountPercentage: 20 },
        { type: 'free_service', description: 'Free consultation and X-ray for family', freeService: { name: 'Family Consultation', quantity: 4 } },
        { type: 'priority_booking', description: 'Priority appointment booking' },
      ],
      displayOrder: 2,
    },
    {
      name: 'Individuals Plan',
      code: 'IND-PLN',
      type: 'individual',
      tier: 'silver',
      description: 'Comprehensive individual dental care package',
      price: 2000,
      discountPercentage: 15,
      maxMembers: 1,
      features: [
        'Comprehensive individual dental care package',
        '₹500 off per clinic visit',
        '30% off on surgery',
        'Free consultation and intraoral X-ray',
      ],
      benefits: [
        { type: 'discount', description: '15% off on all treatments', discountPercentage: 15 },
        { type: 'free_service', description: 'Free consultation and intraoral X-ray', freeService: { name: 'Consultation & X-ray', quantity: 1 } },
      ],
      displayOrder: 3,
    },
  ];

  // Remove old plans that are not in the new default set
  const defaultCodes = defaultPlans.map((p) => p.code);
  await this.deleteMany({ code: { $nin: defaultCodes } });

  // Upsert the 3 default plans
  for (const plan of defaultPlans) {
    await this.findOneAndUpdate({ code: plan.code }, plan, { upsert: true, new: true });
  }

  console.log('Default membership plans seeded (3 plans)');
};

// Create and export the model
const MembershipPlan = mongoose.model('MembershipPlan', membershipPlanSchema);

export default MembershipPlan;
