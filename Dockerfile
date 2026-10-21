FROM php:8.3-apache

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Install CA certificates (for TiDB Cloud SSL) and PDO MySQL extension
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN docker-php-ext-install pdo pdo_mysql

# Create dedicated private storage directory with correct permissions
RUN mkdir -p /var/www/storage/parking_photos && \
    chown -R www-data:www-data /var/www/storage && \
    chmod -R 775 /var/www/storage

# Set default private storage environment variable
ENV PARKING_PRIVATE_STORAGE=/var/www/storage/parking_photos

# Copy project files
COPY . /var/www/html/

# Fix ownership
RUN chown -R www-data:www-data /var/www/html

EXPOSE 80

CMD ["apache2-foreground"]
