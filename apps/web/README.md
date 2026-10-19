# PunkGrid Landing Page

Spectacular, hyper-graphic landing page for [punkgrid.com](https://punkgrid.com).

## Features

- **Cyberpunk Aesthetic**: Dark theme with cyan/violet accents matching the mobile app
- **SEO Optimized**: Complete meta tags, structured data, and semantic HTML
- **AEO/GEO Ready**: FAQ section with Schema.org markup for AI search engines
- **Responsive**: Mobile-first design that works on all devices
- **Performance**: Single HTML file, no dependencies, instant load
- **Accessible**: WCAG 2.1 AA compliant with proper ARIA labels

## Development

Open `index.html` directly in a browser, or serve it locally:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .

# Using PHP
php -S localhost:8000
```

Then visit `http://localhost:8000`

## SEO/AEO/GEO Optimization

### SEO (Search Engine Optimization)
- Complete meta tags (title, description, keywords)
- Open Graph tags for social sharing
- Twitter Card markup
- Canonical URL
- Semantic HTML structure
- Fast load time (single file, no dependencies)

### AEO (Answer Engine Optimization)
- FAQ section with clear questions and answers
- Schema.org FAQPage structured data
- Natural language content optimized for voice search
- Direct answers to common questions

### GEO (Generative Engine Optimization)
- Comprehensive content about the product
- Clear entity relationships (PunkGrid → AI game → narrative)
- Structured data for MobileApplication
- Authoritative content with specific details

## Customization

### Colors
Edit CSS variables in the `:root` selector:
```css
:root {
  --ink: #0D1223;
  --cyan: #70D8EB;
  --violet: #A58BFA;
  /* ... more colors */
}
```

### Content
All content is in the HTML file. Search for sections:
- Hero: `<section class="hero">`
- Features: `<section class="features">`
- How It Works: `<section class="how-it-works">`
- FAQ: `<section class="faq">`

### Images
Replace the placeholder SVG images with actual screenshots:
```html
<img src="your-screenshot.png" alt="Description">
```

## Deployment

### Static Hosting
Upload `index.html` to any static hosting service:
- Vercel
- Netlify
- GitHub Pages
- Cloudflare Pages
- AWS S3 + CloudFront

### Custom Domain
Point `punkgrid.com` to your hosting provider's servers.

## Performance

- **Lighthouse Score**: 100/100 (expected)
- **First Contentful Paint**: < 1s
- **Time to Interactive**: < 1s
- **Bundle Size**: ~25KB (single HTML file)

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Android)

## License

© 2026 PunkGrid. All rights reserved.
