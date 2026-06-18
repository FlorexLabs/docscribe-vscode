namespace :db do
  desc "Migrate the database"
  task migrate: :environment do
    puts "Running migrations"
  end

  desc "Seed the database"
  task seed: :environment do
    puts "Seeding data"
  end
end
