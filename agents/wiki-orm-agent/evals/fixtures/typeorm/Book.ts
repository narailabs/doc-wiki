import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from "typeorm";
import { Author } from "./Author";
import { Publisher } from "./Publisher";

@Entity("books")
export class Book {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @ManyToOne(() => Author, (author) => author.books)
  @JoinColumn({ name: "author_id" })
  author: Author;

  @OneToOne(() => Publisher)
  @JoinColumn({ name: "publisher_id" })
  publisher: Publisher;
}
