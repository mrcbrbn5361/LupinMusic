import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_installer_sidebar(output_path, is_uninstall=False):
    width, height = 164, 314
    # Create base image in RGB (NSIS requires 24-bit RGB BMP)
    img = Image.new('RGB', (width, height), (9, 2, 20))
    draw = ImageDraw.Draw(img)

    # 1. Background Gradient (Obsidian to Deep Purple to Obsidian)
    for y in range(height):
        ratio = y / float(height)
        if ratio < 0.45:
            # Top: 10, 3, 22 -> 35, 12, 65
            sub = ratio / 0.45
            r = int(10 + (35 - 10) * sub)
            g = int(3 + (12 - 3) * sub)
            b = int(22 + (65 - 22) * sub)
        elif ratio < 0.75:
            # Mid: 35, 12, 65 -> 25, 8, 48
            sub = (ratio - 0.45) / 0.30
            r = int(35 + (25 - 35) * sub)
            g = int(12 + (8 - 12) * sub)
            b = int(65 + (48 - 65) * sub)
        else:
            # Bottom: 25, 8, 48 -> 7, 2, 16
            sub = (ratio - 0.75) / 0.25
            r = int(25 + (7 - 25) * sub)
            g = int(8 + (2 - 8) * sub)
            b = int(48 + (16 - 48) * sub)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    # 2. Glowing Radial Background behind Logo
    glow = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    center_x, center_y = width // 2, 88
    for radius in range(70, 10, -5):
        alpha = int((1.0 - (radius / 70.0)) * 95)
        glow_draw.ellipse(
            [center_x - radius, center_y - radius, center_x + radius, center_y + radius],
            fill=(190, 75, 220, alpha)
        )
    glow = glow.filter(ImageFilter.GaussianBlur(8))
    img.paste(Image.composite(glow, Image.new('RGBA', (width, height), (0, 0, 0, 0)), glow), (0, 0), glow)

    # 3. Circular Masked Lupin Logo with Outer Glow Ring
    raw_logo = Image.open('desktop/assets/icon.png').convert('RGBA')
    logo_size = 96
    
    # Circular mask on original high-res logo then resize
    mask = Image.new('L', raw_logo.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse([4, 4, raw_logo.size[0] - 4, raw_logo.size[1] - 4], fill=255)
    raw_logo.putalpha(mask)

    logo_resized = raw_logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    logo_x = (width - logo_size) // 2
    logo_y = center_y - (logo_size // 2)

    # Outer neon ring
    ring_img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    ring_draw = ImageDraw.Draw(ring_img)
    ring_draw.ellipse(
        [logo_x - 2, logo_y - 2, logo_x + logo_size + 2, logo_y + logo_size + 2],
        outline=(236, 72, 153, 220),
        width=2
    )
    ring_draw.ellipse(
        [logo_x - 1, logo_y - 1, logo_x + logo_size + 1, logo_y + logo_size + 1],
        outline=(168, 85, 247, 240),
        width=1
    )
    img.paste(ring_img, (0, 0), ring_img)

    # Drop shadow for logo
    shadow = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse(
        [logo_x - 3, logo_y + 6, logo_x + logo_size + 3, logo_y + logo_size + 12],
        fill=(0, 0, 0, 180)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    img.paste(shadow, (0, 0), shadow)

    # Paste actual logo
    img.paste(logo_resized, (logo_x, logo_y), logo_resized)

    # 4. Draw Typography & Styling
    draw = ImageDraw.Draw(img)

    # Decorative Line with Neon Gradient
    line_y = 152
    draw.line([(24, line_y), (width - 24, line_y)], fill=(168, 85, 247), width=1)
    # Bright center accent
    draw.line([(width // 2 - 25, line_y), (width // 2 + 25, line_y)], fill=(244, 63, 94), width=2)

    try:
        title_font = ImageFont.truetype("arialbd.ttf", 16)
        subtitle_font = ImageFont.truetype("arial.ttf", 9)
        badge_font = ImageFont.truetype("arialbd.ttf", 8)
    except:
        title_font = ImageFont.load_default()
        subtitle_font = ImageFont.load_default()
        badge_font = ImageFont.load_default()

    # "LUPIN MUSIC"
    title_text = "LUPIN MUSIC"
    bbox = draw.textbbox((0, 0), title_text, font=title_font)
    tw = bbox[2] - bbox[0]
    draw.text(((width - tw) // 2, 162), title_text, fill=(255, 255, 255), font=title_font)

    # Subtitle / Tagline
    sub_text = "UNINSTALL WIZARD" if is_uninstall else "NEXT-GEN STREAMING"
    bbox = draw.textbbox((0, 0), sub_text, font=subtitle_font)
    sw = bbox[2] - bbox[0]
    draw.text(((width - sw) // 2, 183), sub_text, fill=(200, 160, 245), font=subtitle_font)

    # Version Badge
    badge_text = "v1.0.0 OFFICIAL"
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    bw = bbox[2] - bbox[0]
    badge_x = (width - bw) // 2
    badge_y = 202
    draw.rounded_rectangle(
        [badge_x - 8, badge_y - 2, badge_x + bw + 8, badge_y + 11],
        radius=5,
        fill=(40, 15, 70),
        outline=(168, 85, 247),
        width=1
    )
    draw.text((badge_x, badge_y), badge_text, fill=(244, 114, 182), font=badge_font)

    # 5. Cyber Audio Equalizer Waves at bottom (spaced cleanly below badge)
    bar_y_bottom = 300
    bars = [8, 16, 28, 14, 38, 48, 35, 44, 24, 34, 42, 20, 28, 14, 22, 10]
    num_bars = len(bars)
    bar_w = 4
    spacing = 3
    total_w = num_bars * bar_w + (num_bars - 1) * spacing
    start_x = (width - total_w) // 2

    for i, bh in enumerate(bars):
        bx = start_x + i * (bar_w + spacing)
        by = bar_y_bottom - bh
        color_ratio = i / float(num_bars - 1)
        cr = int(236 + (168 - 236) * color_ratio)
        cg = int(72 + (85 - 72) * color_ratio)
        cb = int(153 + (247 - 153) * color_ratio)
        draw.rounded_rectangle([bx, by, bx + bar_w, bar_y_bottom], radius=2, fill=(cr, cg, cb))

    # Bottom subtle border
    draw.line([(0, height - 1), (width, height - 1)], fill=(45, 18, 80), width=1)

    # Save as 24-bit BMP
    img.save(output_path, format='BMP')
    print(f"Generated {output_path} successfully ({width}x{height} BMP)")

def create_installer_header(output_path):
    width, height = 150, 57
    img = Image.new('RGB', (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    for x in range(width):
        ratio = x / float(width)
        r = int(255 - 15 * ratio)
        g = int(255 - 20 * ratio)
        b = int(255 - 10 * ratio)
        draw.line([(x, 0), (x, height)], fill=(r, g, b))

    raw_logo = Image.open('desktop/assets/icon.png').convert('RGBA')
    logo_size = 46
    mask = Image.new('L', raw_logo.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse([4, 4, raw_logo.size[0] - 4, raw_logo.size[1] - 4], fill=255)
    raw_logo.putalpha(mask)

    logo_resized = raw_logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    img.paste(logo_resized, (width - logo_size - 8, (height - logo_size) // 2), logo_resized)

    img.save(output_path, format='BMP')
    print(f"Generated {output_path} successfully ({width}x{height} BMP)")

if __name__ == '__main__':
    create_installer_sidebar('desktop/assets/installerSidebar.bmp', is_uninstall=False)
    create_installer_sidebar('desktop/assets/uninstallerSidebar.bmp', is_uninstall=True)
    create_installer_header('desktop/assets/installerHeader.bmp')
