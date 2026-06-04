const ATTRIBUTE_TYPES = {
  text: 'text',
  number: 'number',
  dropdown: 'dropdown',
  boolean: 'boolean',
  multi_select: 'multi_select',
  image: 'image',
  color: 'color',
  size: 'size',
  dimension: 'dimension',
  specification: 'specification',
};

const FIELD_LABELS = {
  brand: 'Brand',
  gender: 'Gender',
  category: 'Category',
  subcategory: 'Subcategory',
  size_chart: 'Size Chart',
  available_sizes: 'Available Sizes',
  upper_material: 'Upper Material',
  sole_material: 'Sole Material',
  insole_material: 'Insole Material',
  closure_type: 'Closure Type',
  heel_height: 'Heel Height',
  toe_shape: 'Toe Shape',
  arch_support: 'Arch Support',
  cushioning: 'Cushioning',
  waterproof: 'Waterproof',
  breathable: 'Breathable',
  weight: 'Weight',
  occasion: 'Occasion',
  color: 'Color',
  country_of_origin: 'Country of Origin',
  care_instructions: 'Care Instructions',
  fabric: 'Fabric',
  fabric_composition: 'Fabric Composition',
  fit: 'Fit',
  collar_type: 'Collar Type',
  sleeve_length: 'Sleeve Length',
  sleeve_type: 'Sleeve Type',
  pattern: 'Pattern',
  weave_type: 'Weave Type',
  stretch: 'Stretch',
  transparency: 'Transparency',
  breathability: 'Breathability',
  neck_type: 'Neck Type',
  rise: 'Rise',
  length: 'Length',
  wash_type: 'Wash Type',
  pocket_count: 'Pocket Count',
  distressed: 'Distressed',
  pleated: 'Pleated',
  dress_length: 'Dress Length',
  lining: 'Lining',
  dial_size: 'Dial Size',
  dial_shape: 'Dial Shape',
  movement_type: 'Movement Type',
  strap_material: 'Strap Material',
  strap_width: 'Strap Width',
  case_material: 'Case Material',
  glass_type: 'Glass Type',
  water_resistance: 'Water Resistance',
  warranty: 'Warranty',
  display_type: 'Display Type',
  battery_type: 'Battery Type',
  frame_material: 'Frame Material',
  lens_material: 'Lens Material',
  lens_type: 'Lens Type',
  uv_protection: 'UV Protection',
  frame_shape: 'Frame Shape',
  polarized: 'Polarized',
  material: 'Material',
  capacity: 'Capacity',
  strap_type: 'Strap Type',
  compartments: 'Compartments',
  laptop_compatible: 'Laptop Compatible',
  water_resistant: 'Water Resistant',
  metal_type: 'Metal Type',
  stone_type: 'Stone Type',
  purity: 'Purity',
  finish: 'Finish',
  certification: 'Certification',
  fragrance_family: 'Fragrance Family',
  top_notes: 'Top Notes',
  middle_notes: 'Middle Notes',
  base_notes: 'Base Notes',
  longevity: 'Longevity',
  concentration: 'Concentration',
  volume: 'Volume',
  usage: 'Usage',
  skin_type: 'Skin Type',
  hair_type: 'Hair Type',
  ingredients: 'Ingredients',
  benefits: 'Benefits',
  usage_instructions: 'Usage Instructions',
  expiry_date: 'Expiry Date',
  shelf_life: 'Shelf Life',
  dimensions: 'Dimensions',
  assembly_required: 'Assembly Required',
  room_type: 'Room Type',
  model_number: 'Model Number',
  specifications: 'Specifications',
  battery_capacity: 'Battery Capacity',
  connectivity: 'Connectivity',
  compatibility: 'Compatibility',
  power_consumption: 'Power Consumption',
};

const DEFAULT_OPTIONS = {
  gender: ['Men', 'Women', 'Unisex', 'Kids'],
  fit: ['Slim', 'Regular', 'Relaxed', 'Oversized', 'Athletic'],
  occasion: ['Casual', 'Formal', 'Office', 'Party', 'Wedding', 'Travel', 'Sport', 'Daily Wear'],
  stretch: ['None', 'Low', 'Medium', 'High'],
  transparency: ['Opaque', 'Sheer', 'Semi-sheer'],
  breathability: ['Low', 'Medium', 'High'],
  rise: ['Low', 'Mid', 'High'],
  wash_type: ['Rinse', 'Light Wash', 'Medium Wash', 'Dark Wash', 'Distressed'],
  closure_type: ['Button', 'Zip', 'Slip-on', 'Lace-up', 'Buckle', 'Velcro', 'Drawstring', 'Toggle'],
  toe_shape: ['Round', 'Square', 'Pointed', 'Almond'],
  neck_type: ['Round Neck', 'V Neck', 'Polo', 'Crew Neck', 'Mandarin Collar', 'Henley', 'Boat Neck'],
  sleeve_type: ['Short Sleeve', 'Half Sleeve', 'Full Sleeve', 'Sleeveless', 'Three Quarter Sleeve'],
  collar_type: ['Spread', 'Button Down', 'Mandarin', 'Cutaway', 'Classic'],
  movement_type: ['Quartz', 'Automatic', 'Mechanical', 'Digital'],
  display_type: ['Analog', 'Digital', 'Hybrid'],
  frame_shape: ['Round', 'Square', 'Aviator', 'Cat Eye', 'Wayfarer'],
  lens_type: ['Single Vision', 'Gradient', 'Mirrored', 'Photochromic'],
  polarized: ['Yes', 'No'],
  water_resistance: ['Splash Resistant', '30m', '50m', '100m', '200m'],
  warranty: ['6 Months', '1 Year', '2 Years', '3 Years'],
  concentration: ['EDT', 'EDP', 'Parfum', 'Body Mist'],
  longevity: ['Light', 'Moderate', 'Long Lasting', 'Very Long Lasting'],
  skin_type: ['Dry', 'Oily', 'Combination', 'Sensitive', 'All Skin Types'],
  hair_type: ['Straight', 'Wavy', 'Curly', 'Coily', 'All Hair Types'],
  assembly_required: ['Yes', 'No'],
  room_type: ['Living Room', 'Bedroom', 'Kitchen', 'Dining Room', 'Bathroom', 'Outdoor'],
  type_boolean: ['Yes', 'No'],
};

const ATTRIBUTE_TEMPLATE_REGISTRY = {
  footwear: {
    label: 'Footwear',
    aliases: ['shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'sandal', 'sandals', 'footwear'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'gender', 'category', 'subcategory', 'occasion', 'color', 'country_of_origin'],
      },
      {
        title: 'Build & Comfort',
        fields: [
          'size_chart',
          'available_sizes',
          'upper_material',
          'sole_material',
          'insole_material',
          'closure_type',
          'heel_height',
          'toe_shape',
          'arch_support',
          'cushioning',
          'waterproof',
          'breathable',
          'weight',
          'care_instructions',
        ],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      gender: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.gender, required: true },
      category: { type: ATTRIBUTE_TYPES.text, required: false, readOnly: true },
      subcategory: { type: ATTRIBUTE_TYPES.text, required: false },
      size_chart: { type: ATTRIBUTE_TYPES.image, required: false },
      available_sizes: { type: ATTRIBUTE_TYPES.size, required: true, variantSupport: true, multi: true },
      upper_material: { type: ATTRIBUTE_TYPES.dropdown, options: ['Leather', 'Mesh', 'Canvas', 'Synthetic', 'Suede', 'Knit'] },
      sole_material: { type: ATTRIBUTE_TYPES.dropdown, options: ['Rubber', 'EVA', 'TPU', 'Leather', 'Phylon'] },
      insole_material: { type: ATTRIBUTE_TYPES.dropdown, options: ['Foam', 'Memory Foam', 'Leather', 'EVA', 'PU'] },
      closure_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.closure_type },
      heel_height: { type: ATTRIBUTE_TYPES.dimension, unit: 'cm' },
      toe_shape: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.toe_shape },
      arch_support: { type: ATTRIBUTE_TYPES.boolean },
      cushioning: { type: ATTRIBUTE_TYPES.dropdown, options: ['None', 'Low', 'Medium', 'High', 'Responsive'] },
      waterproof: { type: ATTRIBUTE_TYPES.boolean },
      breathable: { type: ATTRIBUTE_TYPES.boolean },
      weight: { type: ATTRIBUTE_TYPES.dimension, unit: 'g' },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      country_of_origin: { type: ATTRIBUTE_TYPES.text },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  clothing: {
    label: 'Clothing',
    aliases: ['clothing', 'apparel', 'fashion', 'garment', 'wear'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'gender', 'fabric', 'fabric_composition', 'fit', 'pattern', 'occasion', 'color'],
      },
      {
        title: 'Construction',
        fields: ['collar_type', 'sleeve_length', 'sleeve_type', 'neck_type', 'stretch', 'transparency', 'breathability', 'care_instructions'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      gender: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.gender },
      fabric: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric_composition: { type: ATTRIBUTE_TYPES.specification },
      fit: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.fit },
      pattern: { type: ATTRIBUTE_TYPES.dropdown, options: ['Solid', 'Striped', 'Checked', 'Printed', 'Textured', 'Self Design'] },
      collar_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.collar_type },
      sleeve_length: { type: ATTRIBUTE_TYPES.dropdown, options: ['Short', 'Half', 'Three Quarter', 'Full'] },
      sleeve_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.sleeve_type },
      neck_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.neck_type },
      stretch: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.stretch },
      transparency: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.transparency },
      breathability: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.breathability },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  accessories: {
    label: 'Accessories',
    aliases: ['accessories', 'accessory', 'belt', 'wallet', 'cap', 'scarf'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'material', 'capacity', 'closure_type', 'strap_type', 'occasion', 'color'],
      },
      {
        title: 'Additional Details',
        fields: ['size_chart', 'weight', 'water_resistant', 'care_instructions'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      material: { type: ATTRIBUTE_TYPES.text },
      capacity: { type: ATTRIBUTE_TYPES.dimension, unit: 'L' },
      closure_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.closure_type },
      strap_type: { type: ATTRIBUTE_TYPES.dropdown, options: ['Single Strap', 'Dual Strap', 'Top Handle', 'Crossbody', 'Shoulder Strap'] },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      size_chart: { type: ATTRIBUTE_TYPES.image },
      weight: { type: ATTRIBUTE_TYPES.dimension, unit: 'g' },
      water_resistant: { type: ATTRIBUTE_TYPES.boolean },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  shirt: {
    label: 'Shirt',
    aliases: ['shirt', 'shirts', 'formal shirt', 'casual shirt'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'gender', 'fabric', 'fabric_composition', 'fit', 'color', 'occasion'],
      },
      {
        title: 'Construction',
        fields: [
          'collar_type',
          'sleeve_length',
          'pattern',
          'weave_type',
          'stretch',
          'transparency',
          'care_instructions',
        ],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      gender: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.gender },
      fabric: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric_composition: { type: ATTRIBUTE_TYPES.specification },
      fit: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.fit },
      collar_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.collar_type },
      sleeve_length: { type: ATTRIBUTE_TYPES.dropdown, options: ['Short', 'Half', 'Three Quarter', 'Full'] },
      pattern: { type: ATTRIBUTE_TYPES.dropdown, options: ['Solid', 'Striped', 'Checked', 'Printed', 'Textured', 'Self Design'] },
      weave_type: { type: ATTRIBUTE_TYPES.text },
      stretch: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.stretch },
      transparency: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.transparency },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  tshirt: {
    label: 'T-Shirt',
    aliases: ['tshirt', 't-shirt', 'tee', 'tees'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'fabric', 'fabric_composition', 'fit', 'neck_type', 'sleeve_type', 'pattern'],
      },
      {
        title: 'Comfort',
        fields: ['stretch', 'breathability', 'occasion', 'color', 'care_instructions'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric_composition: { type: ATTRIBUTE_TYPES.specification },
      fit: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.fit },
      neck_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.neck_type },
      sleeve_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.sleeve_type },
      pattern: { type: ATTRIBUTE_TYPES.dropdown, options: ['Solid', 'Printed', 'Striped', 'Graphic', 'Typography', 'Self Design'] },
      stretch: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.stretch },
      breathability: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.breathability },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  jeans: {
    label: 'Jeans',
    aliases: ['jean', 'jeans', 'denim'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'fabric', 'fabric_composition', 'fit', 'rise', 'length', 'color', 'occasion'],
      },
      {
        title: 'Construction',
        fields: ['stretch', 'closure_type', 'wash_type', 'pocket_count', 'distressed', 'care_instructions'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric_composition: { type: ATTRIBUTE_TYPES.specification },
      fit: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.fit },
      rise: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.rise },
      stretch: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.stretch },
      closure_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.closure_type },
      length: { type: ATTRIBUTE_TYPES.dropdown, options: ['Cropped', 'Ankle Length', 'Regular', 'Long', 'Extra Long'] },
      wash_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.wash_type },
      pocket_count: { type: ATTRIBUTE_TYPES.number, min: 0, max: 12 },
      distressed: { type: ATTRIBUTE_TYPES.boolean },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  trousers: {
    label: 'Trousers',
    aliases: ['trouser', 'trousers', 'pant', 'pants'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'fabric', 'fit', 'rise', 'length', 'occasion'],
      },
      {
        title: 'Construction',
        fields: ['closure_type', 'pleated', 'stretch', 'color', 'care_instructions'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric: { type: ATTRIBUTE_TYPES.text, required: true },
      fit: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.fit },
      rise: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.rise },
      closure_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.closure_type },
      pleated: { type: ATTRIBUTE_TYPES.boolean },
      stretch: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.stretch },
      length: { type: ATTRIBUTE_TYPES.dropdown, options: ['Cropped', 'Ankle Length', 'Regular', 'Full Length'] },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  dress: {
    label: 'Dress',
    aliases: ['dress', 'dresses', 'gown'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'fabric', 'dress_length', 'neck_type', 'sleeve_type', 'fit', 'occasion', 'color'],
      },
      {
        title: 'Finish',
        fields: ['lining', 'transparency', 'care_instructions'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      fabric: { type: ATTRIBUTE_TYPES.text, required: true },
      dress_length: { type: ATTRIBUTE_TYPES.dropdown, options: ['Mini', 'Midi', 'Maxi', 'Knee Length', 'Ankle Length'] },
      neck_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.neck_type },
      sleeve_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.sleeve_type },
      fit: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.fit },
      lining: { type: ATTRIBUTE_TYPES.boolean },
      transparency: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.transparency },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
    },
  },
  watch: {
    label: 'Watch',
    aliases: ['watch', 'watches', 'smartwatch'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'dial_size', 'dial_shape', 'movement_type', 'display_type', 'country_of_origin'],
      },
      {
        title: 'Build',
        fields: ['strap_material', 'strap_width', 'case_material', 'glass_type', 'water_resistance', 'battery_type', 'warranty'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      dial_size: { type: ATTRIBUTE_TYPES.dimension, unit: 'mm' },
      dial_shape: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.frame_shape },
      movement_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.movement_type },
      strap_material: { type: ATTRIBUTE_TYPES.dropdown, options: ['Leather', 'Stainless Steel', 'Silicone', 'Nylon', 'Fabric'] },
      strap_width: { type: ATTRIBUTE_TYPES.dimension, unit: 'mm' },
      case_material: { type: ATTRIBUTE_TYPES.dropdown, options: ['Stainless Steel', 'Titanium', 'Aluminium', 'Ceramic', 'Plastic'] },
      glass_type: { type: ATTRIBUTE_TYPES.dropdown, options: ['Mineral', 'Sapphire', 'Hardened Glass', 'Acrylic'] },
      water_resistance: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.water_resistance },
      warranty: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.warranty },
      display_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.display_type },
      battery_type: { type: ATTRIBUTE_TYPES.dropdown, options: ['Battery', 'Rechargeable', 'Solar'] },
      country_of_origin: { type: ATTRIBUTE_TYPES.text },
    },
  },
  sunglasses: {
    label: 'Sunglasses',
    aliases: ['sunglass', 'sunglasses', 'eyewear'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'frame_material', 'frame_shape', 'lens_material', 'lens_type', 'gender'],
      },
      {
        title: 'Protection',
        fields: ['uv_protection', 'polarized', 'weight', 'warranty'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      frame_material: { type: ATTRIBUTE_TYPES.dropdown, options: ['Acetate', 'Metal', 'Plastic', 'Titanium', 'TR90'] },
      lens_material: { type: ATTRIBUTE_TYPES.dropdown, options: ['Polycarbonate', 'Glass', 'CR-39', 'Nylon'] },
      lens_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.lens_type },
      uv_protection: { type: ATTRIBUTE_TYPES.boolean },
      frame_shape: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.frame_shape },
      polarized: { type: ATTRIBUTE_TYPES.boolean },
      weight: { type: ATTRIBUTE_TYPES.dimension, unit: 'g' },
      gender: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.gender },
      warranty: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.warranty },
    },
  },
  bag: {
    label: 'Bag',
    aliases: ['bag', 'bags', 'handbag', 'handbags', 'backpack', 'backpacks'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'material', 'capacity', 'closure_type', 'strap_type', 'occasion'],
      },
      {
        title: 'Functionality',
        fields: ['compartments', 'laptop_compatible', 'water_resistant', 'weight'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      material: { type: ATTRIBUTE_TYPES.text, required: true },
      capacity: { type: ATTRIBUTE_TYPES.dimension, unit: 'L' },
      closure_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.closure_type },
      strap_type: { type: ATTRIBUTE_TYPES.dropdown, options: ['Single Strap', 'Dual Strap', 'Top Handle', 'Crossbody', 'Shoulder Strap'] },
      compartments: { type: ATTRIBUTE_TYPES.number, min: 0, max: 20 },
      laptop_compatible: { type: ATTRIBUTE_TYPES.boolean },
      water_resistant: { type: ATTRIBUTE_TYPES.boolean },
      weight: { type: ATTRIBUTE_TYPES.dimension, unit: 'g' },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
    },
  },
  jewellery: {
    label: 'Jewellery',
    aliases: ['jewellery', 'jewelry', 'ring', 'necklace', 'earring', 'bracelet'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'material', 'metal_type', 'stone_type', 'purity', 'finish'],
      },
      {
        title: 'Assurance',
        fields: ['weight', 'certification', 'occasion'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      material: { type: ATTRIBUTE_TYPES.text },
      metal_type: { type: ATTRIBUTE_TYPES.dropdown, options: ['Gold', 'Silver', 'Platinum', 'Diamond', 'Rose Gold', 'Stainless Steel'] },
      stone_type: { type: ATTRIBUTE_TYPES.dropdown, options: ['Diamond', 'Pearl', 'Ruby', 'Emerald', 'Sapphire', 'None'] },
      purity: { type: ATTRIBUTE_TYPES.text },
      weight: { type: ATTRIBUTE_TYPES.dimension, unit: 'g' },
      finish: { type: ATTRIBUTE_TYPES.dropdown, options: ['Glossy', 'Matte', 'Polished', 'Brushed'] },
      certification: { type: ATTRIBUTE_TYPES.boolean },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
    },
  },
  perfume: {
    label: 'Perfume',
    aliases: ['perfume', 'fragrance', 'fragrances'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'fragrance_family', 'concentration', 'volume', 'gender'],
      },
      {
        title: 'Notes',
        fields: ['top_notes', 'middle_notes', 'base_notes', 'longevity', 'usage'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      fragrance_family: { type: ATTRIBUTE_TYPES.dropdown, options: ['Floral', 'Woody', 'Oriental', 'Fresh', 'Citrus', 'Gourmand', 'Aquatic'] },
      top_notes: { type: ATTRIBUTE_TYPES.multi_select },
      middle_notes: { type: ATTRIBUTE_TYPES.multi_select },
      base_notes: { type: ATTRIBUTE_TYPES.multi_select },
      longevity: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.longevity },
      concentration: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.concentration },
      volume: { type: ATTRIBUTE_TYPES.dimension, unit: 'ml' },
      gender: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.gender },
      usage: { type: ATTRIBUTE_TYPES.dropdown, options: ['Daily Wear', 'Evening', 'Office', 'Party', 'Gift'] },
    },
  },
  beauty: {
    label: 'Beauty',
    aliases: ['beauty', 'skincare', 'makeup', 'haircare'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'skin_type', 'hair_type', 'ingredients', 'benefits', 'volume'],
      },
      {
        title: 'Usage',
        fields: ['usage_instructions', 'expiry_date', 'shelf_life', 'fragrance_family'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      skin_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.skin_type },
      hair_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.hair_type },
      ingredients: { type: ATTRIBUTE_TYPES.multi_select },
      benefits: { type: ATTRIBUTE_TYPES.multi_select },
      usage_instructions: { type: ATTRIBUTE_TYPES.specification },
      expiry_date: { type: ATTRIBUTE_TYPES.text },
      shelf_life: { type: ATTRIBUTE_TYPES.text },
      volume: { type: ATTRIBUTE_TYPES.dimension, unit: 'ml' },
      fragrance_family: { type: ATTRIBUTE_TYPES.dropdown, options: ['Floral', 'Woody', 'Fresh', 'Fruity', 'Oriental'] },
    },
  },
  home_living: {
    label: 'Home & Living',
    aliases: ['home', 'home living', 'furniture', 'decor'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'material', 'dimensions', 'weight', 'room_type', 'finish'],
      },
      {
        title: 'Care & Assembly',
        fields: ['assembly_required', 'warranty', 'care_instructions'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      material: { type: ATTRIBUTE_TYPES.text },
      dimensions: { type: ATTRIBUTE_TYPES.dimension, unit: 'cm' },
      weight: { type: ATTRIBUTE_TYPES.dimension, unit: 'kg' },
      assembly_required: { type: ATTRIBUTE_TYPES.boolean },
      warranty: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.warranty },
      care_instructions: { type: ATTRIBUTE_TYPES.specification },
      room_type: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.room_type },
      finish: { type: ATTRIBUTE_TYPES.dropdown, options: ['Glossy', 'Matte', 'Textured', 'Polished', 'Natural'] },
    },
  },
  electronics: {
    label: 'Electronics',
    aliases: ['electronic', 'electronics', 'gadget', 'gadgets'],
    version: 1,
    sections: [
      {
        title: 'Core Details',
        fields: ['brand', 'model_number', 'specifications', 'battery_capacity', 'connectivity', 'compatibility'],
      },
      {
        title: 'Power & Assurance',
        fields: ['warranty', 'power_consumption', 'dimensions', 'weight'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text, required: true },
      model_number: { type: ATTRIBUTE_TYPES.text },
      specifications: { type: ATTRIBUTE_TYPES.specification },
      battery_capacity: { type: ATTRIBUTE_TYPES.dimension, unit: 'mAh' },
      connectivity: { type: ATTRIBUTE_TYPES.multi_select },
      compatibility: { type: ATTRIBUTE_TYPES.multi_select },
      warranty: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.warranty },
      power_consumption: { type: ATTRIBUTE_TYPES.dimension, unit: 'W' },
      dimensions: { type: ATTRIBUTE_TYPES.dimension, unit: 'cm' },
      weight: { type: ATTRIBUTE_TYPES.dimension, unit: 'g' },
    },
  },
  generic: {
    label: 'Generic',
    aliases: [],
    version: 1,
    sections: [
      {
        title: 'Product Details',
        fields: ['brand', 'material', 'fit', 'usage', 'occasion', 'color'],
      },
    ],
    fields: {
      brand: { type: ATTRIBUTE_TYPES.text },
      material: { type: ATTRIBUTE_TYPES.text },
      fit: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.fit },
      usage: { type: ATTRIBUTE_TYPES.text },
      occasion: { type: ATTRIBUTE_TYPES.dropdown, options: DEFAULT_OPTIONS.occasion },
      color: { type: ATTRIBUTE_TYPES.color, multi: true },
    },
  },
};

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeCategoryKey(category = '', subcategory = '') {
  const text = `${normalizeText(category)} ${normalizeText(subcategory)}`.toLowerCase();
  if (!text) return 'generic';
  if (text.includes('t-shirt') || text.includes('tee')) return 'tshirt';
  if (text.includes('shirt')) return 'shirt';
  if (text.includes('jean')) return 'jeans';
  if (text.includes('trouser') || text.includes('pant')) return 'trousers';
  if (text.includes('dress')) return 'dress';
  if (text.includes('watch')) return 'watch';
  if (text.includes('sunglass') || text.includes('eyewear')) return 'sunglasses';
  if (text.includes('bag') || text.includes('backpack') || text.includes('handbag')) return 'bag';
  if (text.includes('jewel') || text.includes('ring') || text.includes('necklace')) return 'jewellery';
  if (text.includes('perfume') || text.includes('fragrance')) return 'perfume';
  if (text.includes('beauty') || text.includes('skincare') || text.includes('makeup')) return 'beauty';
  if (text.includes('home') || text.includes('decor') || text.includes('furniture')) return 'home_living';
  if (text.includes('electronic') || text.includes('gadget')) return 'electronics';
  if (
    text.includes('men') ||
    text.includes('women') ||
    text.includes('wedding') ||
    text.includes('formal') ||
    text.includes('apparel') ||
    text.includes('fashion')
  ) {
    return 'clothing';
  }
  if (text.includes('accessor') || text.includes('wallet') || text.includes('belt')) {
    return 'accessories';
  }
  if (
    text.includes('shoe') ||
    text.includes('sneaker') ||
    text.includes('boot') ||
    text.includes('sandal')
  ) {
    return 'footwear';
  }
  for (const [key, template] of Object.entries(ATTRIBUTE_TEMPLATE_REGISTRY)) {
    if (key === 'generic') continue;
    if ((template.aliases || []).some((alias) => text.includes(alias.toLowerCase()))) {
      return key;
    }
  }
  if (
    text.includes('kurta') ||
    text.includes('top') ||
    text.includes('jacket') ||
    text.includes('coat')
  ) {
    return 'shirt';
  }
  return 'generic';
}

function getAttributeTemplateForCategory(category = '', subcategory = '') {
  const normalizedKey = normalizeCategoryKey(category, subcategory);
  return {
    key: normalizedKey,
    ...ATTRIBUTE_TEMPLATE_REGISTRY[normalizedKey],
  };
}

function getTemplateFieldDefinition(templateKey, fieldKey) {
  const template = ATTRIBUTE_TEMPLATE_REGISTRY[templateKey] || ATTRIBUTE_TEMPLATE_REGISTRY.generic;
  return template.fields?.[fieldKey] || { type: ATTRIBUTE_TYPES.text };
}

function normalizeStructuredValue(definition, value) {
  const type = definition?.type || ATTRIBUTE_TYPES.text;
  if (value == null) {
    return '';
  }
  if (type === ATTRIBUTE_TYPES.boolean) {
    if (typeof value === 'boolean') return value;
    const text = normalizeText(value).toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(text)) return true;
    if (['false', '0', 'no', 'n'].includes(text)) return false;
    return '';
  }
  if (type === ATTRIBUTE_TYPES.number || type === ATTRIBUTE_TYPES.dimension) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : '';
  }
  if (type === ATTRIBUTE_TYPES.multi_select) {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeText(item)).filter(Boolean);
    }
    return normalizeText(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (type === ATTRIBUTE_TYPES.color) {
    if (Array.isArray(value)) {
      return value.map((item) => normalizeText(item)).filter(Boolean);
    }
    return normalizeText(value);
  }
  return normalizeText(value);
}

function normalizeStructuredAttributes(category, rawStructured = {}, rawFlat = {}) {
  const template = getAttributeTemplateForCategory(category);
  const source = rawStructured && typeof rawStructured === 'object' && !Array.isArray(rawStructured)
    ? rawStructured
    : {};
  const fallback = rawFlat && typeof rawFlat === 'object' && !Array.isArray(rawFlat) ? rawFlat : {};
  const entries = [];
  const flatten = {};

  for (const section of template.sections || []) {
    for (const fieldKey of section.fields || []) {
      const definition = getTemplateFieldDefinition(template.key, fieldKey);
      const rawValue =
        source[fieldKey]?.value ??
        source[fieldKey] ??
        fallback[fieldKey] ??
        fallback[fieldKey.replace(/_/g, ' ')] ??
        '';
      const value = normalizeStructuredValue(definition, rawValue);
      if (
        value == null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      ) {
        continue;
      }
      const record = {
        key: fieldKey,
        label: FIELD_LABELS[fieldKey] || fieldKey.replace(/_/g, ' '),
        type: definition.type || ATTRIBUTE_TYPES.text,
        required: Boolean(definition.required),
        readOnly: Boolean(definition.readOnly),
        filterable: definition.filterable !== false,
        variantSupport: Boolean(definition.variantSupport),
        unit: definition.unit || '',
        options: Array.isArray(definition.options) ? definition.options : [],
        section: section.title || '',
        order: entries.length,
        value,
      };
      entries.push(record);
      flatten[fieldKey] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  return {
    templateKey: template.key,
    templateVersion: Number(template.version || 1),
    structuredAttributes: entries,
    attributes: flatten,
  };
}

function flattenStructuredAttributes(structuredAttributes = []) {
  const output = {};
  if (!Array.isArray(structuredAttributes)) {
    return output;
  }
  for (const entry of structuredAttributes) {
    if (!entry || typeof entry !== 'object') continue;
    const key = normalizeText(entry.key);
    if (!key) continue;
    const value = entry.value;
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    output[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return output;
}

function sanitizeAttributes(category, attributes) {
  return normalizeStructuredAttributes(category, {}, attributes).attributes;
}

function sanitizeStructuredAttributes(category, structuredAttributes, attributes = {}) {
  return normalizeStructuredAttributes(category, structuredAttributes, attributes);
}

function templateToSections(templateOrKey, structuredAttributes = []) {
  const template =
    typeof templateOrKey === 'string'
      ? ATTRIBUTE_TEMPLATE_REGISTRY[templateOrKey] || ATTRIBUTE_TEMPLATE_REGISTRY.generic
      : templateOrKey || ATTRIBUTE_TEMPLATE_REGISTRY.generic;
  const values = new Map(
    (Array.isArray(structuredAttributes) ? structuredAttributes : [])
      .filter(Boolean)
      .map((entry) => [normalizeText(entry.key), entry]),
  );
  return (template.sections || []).map((section) => ({
    title: section.title,
    fields: (section.fields || []).map((fieldKey) => {
      const definition = getTemplateFieldDefinition(template.key || 'generic', fieldKey);
      const entry = values.get(fieldKey) || {};
      return {
        key: fieldKey,
        label: FIELD_LABELS[fieldKey] || fieldKey.replace(/_/g, ' '),
        type: definition.type || ATTRIBUTE_TYPES.text,
        required: Boolean(definition.required),
        readOnly: Boolean(definition.readOnly),
        filterable: definition.filterable !== false,
        variantSupport: Boolean(definition.variantSupport),
        unit: definition.unit || '',
        options: Array.isArray(definition.options) ? definition.options : [],
        value: entry.value ?? '',
      };
    }),
  }));
}

function getFilterableAttributeSections(category, subcategory = '') {
  const template = getAttributeTemplateForCategory(category, subcategory);
  return (template.sections || [])
    .map((section) => ({
      title: section.title,
      fields: (section.fields || []).filter((fieldKey) => {
        const definition = getTemplateFieldDefinition(template.key || 'generic', fieldKey);
        return definition.filterable !== false;
      }),
    }))
    .filter((section) => section.fields.length > 0);
}

function getFilterableAttributeKeys(category, subcategory = '') {
  return new Set(
    getFilterableAttributeSections(category, subcategory).flatMap((section) => section.fields),
  );
}

const categoryAttributeConfig = Object.fromEntries(
  Object.entries(ATTRIBUTE_TEMPLATE_REGISTRY).map(([key, template]) => [
    key,
    {
      sections: (template.sections || []).map((section) => ({
        title: section.title,
        fields: section.fields || [],
      })),
    },
  ]),
);

const genericFields = categoryAttributeConfig.generic.sections.flatMap((section) => section.fields);

module.exports = {
  ATTRIBUTE_TYPES,
  ATTRIBUTE_TEMPLATE_REGISTRY,
  FIELD_LABELS,
  categoryAttributeConfig,
  genericFields,
  normalizeCategoryKey,
  normalizeCategory: normalizeCategoryKey,
  getAttributeTemplateForCategory,
  sanitizeAttributes,
  sanitizeStructuredAttributes,
  flattenStructuredAttributes,
  templateToSections,
  getFilterableAttributeSections,
  getFilterableAttributeKeys,
};
